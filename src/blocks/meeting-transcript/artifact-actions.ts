// 音声ノートのブロックの「清書」「要約」「ノートに書き出す」の組み立て（純関数。エディタは引数で受ける）
//
// - AI へは発言に短い id（文字起こし s1, s2, … / 清書 c1, c2, …）を付けて渡し、返ってきた id を
//   (track, startMs) の根拠に戻して保存する（artifacts.ts）
// - 書き出しは、このブロックから前に書き出したものの後ろに順に足す（writtenBlockIds）。
//   書き出した段落からはブロックへ derived_from を張り、出どころをたどれるようにする

import type { LinkStore } from "../../features/block-link/store";
import { formatSegmentLine, mmss, type TranscriptSegment } from "../../features/meeting-recorder/transcript-format";
import type { SummaryResult, SummaryUtterance } from "../../features/meeting-recorder/summary-service";
import type {
  ArtifactSource,
  CleanupDoc,
  CleanupParagraph,
  SummaryDoc,
  SummaryDocItem,
} from "../../features/meeting-recorder/artifacts";
import { buildSummaryPlan, existingIds, hashTexts, parseIdList, pruneNestedIds, type SummaryLabels } from "./summary";

type LinkApi = Pick<LinkStore, "addLink" | "removeLinksForBlock">;

const textContent = (text: string) => [{ type: "text" as const, text, styles: {} }];

/** 文字起こしの発言を AI に渡す形にする（id は s1, s2, …） */
export function segmentsToUtterances(segments: TranscriptSegment[]): SummaryUtterance[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .map((s, i) => ({ id: `s${i + 1}`, track: s.track ?? null, startMs: s.startMs, text: s.text }));
}

/** 清書の段落を AI に渡す形にする（id は段落の id） */
export function cleanupToUtterances(doc: CleanupDoc): SummaryUtterance[] {
  return doc.paragraphs.map((p) => ({ id: p.id, track: p.track, startMs: p.startMs, text: p.text }));
}

function sourceOf(u: SummaryUtterance): ArtifactSource {
  return { track: u.track, startMs: u.startMs };
}

/** 清書の結果（段落と根拠の発言 id）から保存する形を作る。根拠の無い段落は捨てる */
export function buildCleanupDoc(
  paragraphs: Array<{ text: string; sources: string[] }>,
  utterances: SummaryUtterance[],
  model: string,
  now: Date = new Date(),
  fixes: Array<{ heard: string; meant: string }> = [],
): CleanupDoc | null {
  const byId = new Map(utterances.map((u) => [u.id, u] as const));
  const out: CleanupParagraph[] = [];
  for (const p of paragraphs) {
    const src = p.sources.map((id) => byId.get(id)).filter((u): u is SummaryUtterance => !!u);
    const text = p.text.trim();
    if (src.length === 0 || !text) continue;
    // 話者は最初の根拠の発言のもの（AI には話者を混ぜないよう頼んでいる）
    out.push({
      id: `c${out.length + 1}`,
      track: src[0].track,
      startMs: Math.min(...src.map((u) => u.startMs)),
      text,
      sources: src.map(sourceOf),
    });
  }
  if (out.length === 0) return null;
  out.sort((a, b) => a.startMs - b.startMs);
  out.forEach((p, i) => (p.id = `c${i + 1}`));
  return { version: 1, createdAt: now.toISOString(), model, paragraphs: out, ...(fixes.length > 0 ? { fixes } : {}) };
}

/**
 * ノートに書かれたメモ（議題・会議中のメモ）を、清書と要約の手がかりとして集める。
 * このブロック自身と、このブロックから書き出したブロック（AI の文）は含めない。上から順に最大 maxChars 字
 */
export function collectNoteMemo(editor: any, block: any, maxChars = 2000): string {
  const doc = editor?.document;
  if (!Array.isArray(doc)) return "";
  const cur = editor.getBlock?.(block.id) ?? block;
  const skip = new Set<string>([cur.id, ...parseIdList(cur.props?.writtenBlockIds), ...parseIdList(cur.props?.expandedBlockIds), ...parseIdList(cur.props?.summaryBlockIds)]);
  const lines: string[] = [];
  let total = 0;
  const textOf = (b: any): string => {
    const c = b?.content;
    if (typeof c === "string") return c;
    if (!Array.isArray(c)) return "";
    return c.map((x: any) => (typeof x?.text === "string" ? x.text : Array.isArray(x?.content) ? x.content.map((y: any) => y?.text ?? "").join("") : "")).join("");
  };
  const walk = (blocks: any[]): boolean => {
    for (const b of blocks) {
      if (skip.has(b.id)) continue;
      const t = textOf(b).trim();
      if (t) {
        lines.push(t);
        total += t.length + 1;
        if (total >= maxChars) return false;
      }
      if (Array.isArray(b.children) && b.children.length > 0 && !walk(b.children)) return false;
    }
    return true;
  };
  walk(doc);
  return [...lines.join("\n")].slice(0, maxChars).join("");
}

/**
 * 要約の結果（根拠は入力の id）から保存する形を作る。根拠は文字起こしの発言 (track, startMs) に戻す
 * （清書から作ったときは、清書の段落がまとめた元の発言まで戻す）。項目が 1 つも無ければ null
 */
export function buildSummaryDoc(
  result: Pick<SummaryResult, "decisions" | "todos" | "issues" | "model">,
  utterances: SummaryUtterance[],
  cleanup: CleanupDoc | null,
  now: Date = new Date(),
): SummaryDoc | null {
  const byId = new Map(utterances.map((u) => [u.id, u] as const));
  const cleanupById = new Map((cleanup?.paragraphs ?? []).map((p) => [p.id, p] as const));
  const resolve = (ids: string[]): ArtifactSource[] => {
    const out: ArtifactSource[] = [];
    for (const id of ids) {
      const para = cleanupById.get(id);
      if (para) out.push(...(para.sources.length > 0 ? para.sources : [{ track: para.track, startMs: para.startMs }]));
      else {
        const u = byId.get(id);
        if (u) out.push(sourceOf(u));
      }
    }
    // 同じ発言は 1 つに
    const seen = new Set<string>();
    return out.filter((s) => {
      const k = `${s.track}:${s.startMs}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  const items = (xs: Array<{ text: string; sources: string[] }>): SummaryDocItem[] =>
    xs.map((x) => ({ text: x.text, sources: resolve(x.sources) }));
  const doc: SummaryDoc = {
    version: 1,
    createdAt: now.toISOString(),
    model: result.model,
    basedOn: cleanup ? "cleanup" : "transcript",
    decisions: items(result.decisions),
    todos: result.todos.map((x) => ({
      text: x.text,
      sources: resolve(x.sources),
      ...(x.owner ? { owner: x.owner } : {}),
      ...(x.due ? { due: x.due } : {}),
    })),
    issues: items(result.issues),
  };
  return doc.decisions.length + doc.todos.length + doc.issues.length > 0 ? doc : null;
}

export type WriteOutLabels = SummaryLabels & {
  other: string;
  self: string;
  cleanupHeading: string;
  cleanupAiNote: string;
};

/** 書き出す「文字起こし（原本）」: 見出し + 発言ごとの段落 */
export function buildTranscriptWriteOut(segments: TranscriptSegment[], labels: WriteOutLabels): any[] {
  return [
    { type: "heading", props: { level: 2 }, content: textContent(labels.transcriptHeading) },
    ...segments.map((s) => ({
      type: "paragraph",
      content: textContent(formatSegmentLine(s, { other: labels.other, self: labels.self })),
    })),
  ];
}

/** 書き出す「清書」: 見出し + AI が整えた旨の一文 + 段落 */
export function buildCleanupWriteOut(doc: CleanupDoc, labels: WriteOutLabels): any[] {
  return [
    { type: "heading", props: { level: 2 }, content: textContent(labels.cleanupHeading) },
    { type: "paragraph", content: textContent(labels.cleanupAiNote) },
    ...doc.paragraphs.map((p) => ({
      type: "paragraph",
      content: textContent(formatSegmentLine({ startMs: p.startMs, track: p.track, text: p.text }, labels)),
    })),
  ];
}

/** 根拠の時刻を項目の後ろに付ける（最初の 3 つまで）。ノートでも出どころの時刻が読めるように */
function withTimes(text: string, sources: ArtifactSource[]): string {
  const times = [...sources].sort((a, b) => a.startMs - b.startMs).slice(0, 3).map((s) => `[${mmss(s.startMs)}]`);
  return times.length > 0 ? `${text} ${times.join(" ")}` : text;
}

/**
 * 保存した要約を、書き出し用の結果（根拠の時刻を本文に付けたもの）にする。
 * TODO の担当・期限は時刻より前に置く（ブロックの中の並び「本文 — 担当: … [00:19]」と揃える）。
 * そのため担当・期限は本文に含めて返し、owner / due は付けない（buildSummaryPlan が二重に足さないように）
 */
export function summaryDocToPlanInput(
  doc: SummaryDoc,
  labels: Pick<SummaryLabels, "owner" | "due">,
): Pick<SummaryResult, "decisions" | "todos" | "issues"> {
  return {
    decisions: doc.decisions.map((x) => ({ text: withTimes(x.text, x.sources), sources: [] })),
    todos: doc.todos.map((x) => {
      const extra = [x.owner ? `${labels.owner}: ${x.owner}` : "", x.due ? `${labels.due}: ${x.due}` : ""].filter(Boolean);
      const text = extra.length > 0 ? `${x.text} — ${extra.join(" / ")}` : x.text;
      return { text: withTimes(text, x.sources), sources: [] };
    }),
    issues: doc.issues.map((x) => ({ text: withTimes(x.text, x.sources), sources: [] })),
  };
}

/** 文書の全ブロックの id を、上から順に（子も含めて）並べる。editor.document が無ければ null */
function documentOrder(editor: any): string[] | null {
  const doc = editor.document;
  if (!Array.isArray(doc)) return null;
  const out: string[] = [];
  const walk = (blocks: any[]) => {
    for (const b of blocks) {
      out.push(b.id);
      if (Array.isArray(b.children) && b.children.length > 0) walk(b.children);
    }
  };
  walk(doc);
  return out;
}

/**
 * 書き出す位置: このブロックから前に書き出したもののうち、文書の中でいちばん後ろのブロック（無ければブロック自身）。
 * 書き出した段落を字下げして子にしていても見つかるよう、文書全体を上から順にたどる
 * （BlockNote の getNextBlock は兄弟しか返さない）
 */
export function writeOutAnchor(editor: any, block: any, writtenIds: string[]): any {
  const alive = new Set(writtenIds.filter((id) => !!editor.getBlock?.(id)));
  if (alive.size === 0) return block;
  const order = documentOrder(editor);
  if (order) {
    const at = new Map(order.map((id, i) => [id, i] as const));
    const blockAt = at.get(block.id) ?? -1;
    let best: string | null = null;
    let bestAt = -1;
    for (const id of alive) {
      const p = at.get(id);
      if (p !== undefined && p > bestAt) {
        best = id;
        bestAt = p;
      }
    }
    return best && bestAt > blockAt ? editor.getBlock(best) : block;
  }
  // ブロックの後ろを順にたどり、最後に出会った書き出し済みのブロックを返す
  let last: any = block;
  let cur = editor.getNextBlock?.(block);
  let seen = 0;
  while (cur && seen < alive.size) {
    if (alive.has(cur.id)) {
      last = cur;
      seen += 1;
    }
    cur = editor.getNextBlock?.(cur);
  }
  return last;
}

/**
 * 段落群を書き出す（原本・清書）。位置は writeOutAnchor の後ろ。各ブロックからこのブロックへ
 * derived_from を張り、書き出したブロックの id を返す
 */
export function writeOutBlocks(
  editor: any,
  linkStore: LinkApi | null,
  block: any,
  blocks: any[],
  createdBy: "system" | "ai",
): string[] {
  const cur = editor.getBlock?.(block.id) ?? block;
  const anchor = writeOutAnchor(editor, cur, parseIdList(cur.props?.writtenBlockIds));
  const inserted: any[] = editor.insertBlocks(blocks, anchor, "after") ?? [];
  const ids = inserted.map((b) => b.id as string);
  for (const id of ids) {
    linkStore?.addLink({ sourceBlockId: id, targetBlockId: cur.id, type: "derived_from", createdBy, layer: "prov" });
  }
  rememberWritten(editor, cur, ids);
  return ids;
}

function rememberWritten(editor: any, block: any, ids: string[], extra: Record<string, unknown> = {}): void {
  const cur = editor.getBlock?.(block.id) ?? block;
  const prev = existingIds(editor, cur.props?.writtenBlockIds);
  editor.updateBlock(cur, { props: { writtenBlockIds: JSON.stringify([...prev, ...ids]), ...extra } });
}

/**
 * 要約を書き出す。前に書き出した要約（summaryBlockIds）があれば、その場所で差し替える。
 * 無ければ writeOutAnchor の後ろ。各項目からこのブロックへ derived_from（ai）を張る。
 * 空の要約では何もしない（null）
 */
export function writeOutSummary(
  editor: any,
  linkStore: LinkApi | null,
  block: any,
  doc: SummaryDoc,
  labels: SummaryLabels,
): string[] | null {
  const plan = buildSummaryPlan(summaryDocToPlanInput(doc, labels), labels);
  if (plan.blocks.length <= 2) return null; // 見出しと注記だけ = 項目なし
  const cur = editor.getBlock?.(block.id) ?? block;
  const old = existingIds(editor, cur.props?.summaryBlockIds);
  let inserted: any[];
  if (old.length > 0) {
    // 前回の要約の先頭の前に入れてから、前回の分を消す（位置を保つ）
    const first = editor.getBlock(old[0]);
    inserted = editor.insertBlocks(plan.blocks, first, "before") ?? [];
    editor.removeBlocks(pruneNestedIds(editor, old));
    for (const id of old) linkStore?.removeLinksForBlock(id);
  } else {
    const anchor = writeOutAnchor(editor, cur, parseIdList(cur.props?.writtenBlockIds));
    inserted = editor.insertBlocks(plan.blocks, anchor, "after") ?? [];
  }
  const ids = inserted.map((b) => b.id as string);
  inserted.forEach((b) => {
    if (b.type !== "bulletListItem") return;
    linkStore?.addLink({ sourceBlockId: b.id, targetBlockId: cur.id, type: "derived_from", createdBy: "ai", layer: "prov" });
  });
  const hash = hashTexts(plan.blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "")));
  const oldSet = new Set(old);
  const prevWritten = existingIds(editor, cur.props?.writtenBlockIds).filter((id) => !oldSet.has(id));
  editor.updateBlock(cur, {
    props: { summaryBlockIds: JSON.stringify(ids), summaryHash: hash, writtenBlockIds: JSON.stringify([...prevWritten, ...ids]) },
  });
  return ids;
}
