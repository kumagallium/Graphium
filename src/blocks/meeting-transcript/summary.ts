// 会議の要約: 展開した段落の収集・本文への差し込み・根拠リンクの作成（エディタ操作は引数で受ける）

import type { LinkStore } from "../../features/block-link/store";
import type { SummaryResult, SummaryUtterance } from "../../features/meeting-recorder/summary-service";

export type SummaryLabels = {
  summaryHeading: string;
  aiNote: string;
  decisions: string;
  todos: string;
  issues: string;
  transcriptHeading: string;
  owner: string;
  due: string;
};

type LinkApi = Pick<LinkStore, "addLink" | "removeLinksForBlock">;

const LINE_RE = /^\[(\d{1,}):(\d{2})\]\s?/;

/** JSON 文字列の id 配列を読む（壊れていれば空） */
export function parseIdList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function plainText(block: any): string {
  const c = block?.content;
  if (!Array.isArray(c)) return "";
  return c.map((x: any) => (typeof x?.text === "string" ? x.text : "")).join("");
}

/** ブロック直後から、`[mm:ss]` で始まる段落が続く限り集める（展開の記録が無い古いブロック用） */
export function collectExpandedParagraphs(editor: any, block: any): any[] {
  const out: any[] = [];
  let cur = editor.getNextBlock(block);
  while (cur && cur.type === "paragraph" && LINE_RE.test(plainText(cur))) {
    out.push(cur);
    cur = editor.getNextBlock(cur);
  }
  return out;
}

/** 段落 1 つを発言に戻す。`[14:03] 相手: text` → { startMs, track, text } */
export function paragraphToUtterance(
  block: any,
  labels: { other: string; self: string },
): SummaryUtterance | null {
  const text = plainText(block);
  const m = LINE_RE.exec(text);
  if (!m) return null;
  const startMs = (Number(m[1]) * 60 + Number(m[2])) * 1000;
  let rest = text.slice(m[0].length);
  let track: "system" | "mic" | null = null;
  if (rest.startsWith(`${labels.other}: `)) {
    track = "system";
    rest = rest.slice(labels.other.length + 2);
  } else if (rest.startsWith(`${labels.self}: `)) {
    track = "mic";
    rest = rest.slice(labels.self.length + 2);
  }
  const body = rest.trim();
  if (!body) return null;
  return { id: block.id, track, startMs, text: body };
}

/** 実在する id だけ残す（複製・削除で古い id を指していることがある） */
export function existingIds(editor: any, raw: unknown): string[] {
  return parseIdList(raw).filter((id) => !!editor.getBlock?.(id));
}

/** 親も対象に含まれる子は除く（親を消せば子も消え、BlockNote は子孫へ降りないので子の id は throw する） */
export function pruneNestedIds(editor: any, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let p = editor.getParentBlock?.(id);
    while (p) {
      if (set.has(p.id)) return false;
      p = editor.getParentBlock?.(p.id);
    }
    return true;
  });
}

/** 文字列群の短いハッシュ（djb2）。要約を人が書き換えたかの判定に使う */
export function hashTexts(texts: string[]): string {
  let h = 5381;
  for (const ch of texts.join("\n")) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h.toString(36);
}

/** 差し込んだ要約が、いま編集されているか（記録したハッシュと現在のテキストが違う） */
export function isSummaryEdited(editor: any, props: { summaryBlockIds?: unknown; summaryHash?: unknown }): boolean {
  const hash = typeof props.summaryHash === "string" ? props.summaryHash : "";
  if (!hash) return false;
  const ids = parseIdList(props.summaryBlockIds);
  if (ids.length === 0) return false;
  const texts = ids.map((id) => {
    const b = editor.getBlock?.(id);
    return b ? plainText(b) : "";
  });
  return hashTexts(texts) !== hash;
}

export function isEmptySummaryResult(r: Pick<SummaryResult, "decisions" | "todos" | "issues">): boolean {
  return r.decisions.length + r.todos.length + r.issues.length === 0;
}

const textContent = (text: string) => [{ type: "text" as const, text, styles: {} }];

/** 要約の本文ブロックと、各ブロックの根拠段落 id（blocks と同じ添字。根拠なしは空配列） */
export function buildSummaryPlan(
  result: Pick<SummaryResult, "decisions" | "todos" | "issues">,
  labels: SummaryLabels,
): { blocks: any[]; sources: string[][] } {
  const blocks: any[] = [];
  const sources: string[][] = [];
  const push = (b: any, src: string[] = []) => {
    blocks.push(b);
    sources.push(src);
  };
  const sections: Array<{ title: string; items: Array<{ text: string; sources: string[] }> }> = [
    { title: labels.decisions, items: result.decisions },
    {
      title: labels.todos,
      items: result.todos.map((x) => {
        const extra = [
          x.owner ? `${labels.owner}: ${x.owner}` : "",
          x.due ? `${labels.due}: ${x.due}` : "",
        ].filter(Boolean);
        return { text: extra.length > 0 ? `${x.text} — ${extra.join(" / ")}` : x.text, sources: x.sources };
      }),
    },
    { title: labels.issues, items: result.issues },
  ];
  push({ type: "heading", props: { level: 2 }, content: textContent(labels.summaryHeading) });
  push({ type: "paragraph", content: textContent(labels.aiNote) });
  for (const sec of sections) {
    if (sec.items.length === 0) continue;
    push({ type: "heading", props: { level: 3 }, content: textContent(sec.title) });
    for (const it of sec.items) {
      push({ type: "bulletListItem", content: textContent(it.text) }, it.sources ?? []);
    }
  }
  return { blocks, sources };
}

export function buildSummaryBlocks(
  result: Pick<SummaryResult, "decisions" | "todos" | "issues">,
  labels: SummaryLabels,
): any[] {
  return buildSummaryPlan(result, labels).blocks;
}

/**
 * 要約をブロック直後へ差し込み、各項目から根拠の段落へ derived_from（ai）を張る。
 * 既存の要約（props.summaryBlockIds）は先に削除して差し直す。戻り値は新しい要約ブロックの id。
 */
export function insertSummary(
  editor: any,
  linkStore: LinkApi | null,
  block: any,
  result: SummaryResult,
  labels: SummaryLabels,
): string[] | null {
  // 空の結果では何も差し替えない（旧要約とリンクをそのまま残す）
  if (isEmptySummaryResult(result)) return null;
  const cur = editor.getBlock?.(block.id) ?? block;
  // 1. 既存の要約を消す。先にブロック、成功したらリンク（失敗したら旧要約を残して throw）
  const old = existingIds(editor, cur.props?.summaryBlockIds);
  if (old.length > 0) {
    editor.removeBlocks(pruneNestedIds(editor, old));
    for (const id of old) linkStore?.removeLinksForBlock(id);
  }
  // 2. 段落群の直前に「文字起こし」見出しが無ければ足す
  const paragraphIds = existingIds(editor, cur.props?.expandedBlockIds);
  const first = paragraphIds.length > 0 ? editor.getBlock(paragraphIds[0]) : null;
  if (first) {
    const prev = editor.getPrevBlock?.(first);
    const hasHeading = prev?.type === "heading" && plainText(prev) === labels.transcriptHeading;
    if (!hasHeading) {
      editor.insertBlocks(
        [{ type: "heading", props: { level: 2 }, content: textContent(labels.transcriptHeading) }],
        first,
        "before",
      );
    }
  }
  // 3. 要約をブロック直後へ
  const plan = buildSummaryPlan(result, labels);
  const inserted: any[] = editor.insertBlocks(plan.blocks, cur, "after") ?? [];
  const ids = inserted.map((b) => b.id as string);
  // 4. 根拠リンク（入力に無い id は張らない）
  const valid = new Set(paragraphIds);
  inserted.forEach((b, i) => {
    for (const src of plan.sources[i] ?? []) {
      if (!valid.has(src)) continue;
      linkStore?.addLink({
        sourceBlockId: b.id,
        targetBlockId: src,
        type: "derived_from",
        createdBy: "ai",
        layer: "prov",
      });
    }
  });
  const hash = hashTexts(plan.blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "")));
  editor.updateBlock(cur, { props: { summaryBlockIds: JSON.stringify(ids), summaryHash: hash } });
  return ids;
}

/** 展開で作った段落から文字起こしブロックへ derived_from（system）を張る */
export function linkParagraphsToBlock(linkStore: LinkApi | null, paragraphIds: string[], blockId: string): void {
  for (const id of paragraphIds) {
    linkStore?.addLink({
      sourceBlockId: id,
      targetBlockId: blockId,
      type: "derived_from",
      createdBy: "system",
      layer: "prov",
    });
  }
}
