// ノートに付いたメモ（captures.json）を、付け先ごとに読める形にする。
//
// get_note / get_note_steps が、手順と一緒にメモを返すための共通の口。
// メモの付け先は 3 つある（features/mobile-capture/capture-store.ts）:
//   - つながり（sourceEdge）: 手順 → 手順（steps）、工程 → 工程（plan）の線
//   - ブロック（sourceNote.blockId）: 手順ブロックやその中のブロック
//   - ノート全体（sourceNote だけ）
// アーカイブ・ゴミ箱のメモは返さない（PROV の書き出しと同じ）。作成者のメールアドレスは返さない。

import type { CaptureEntry, CaptureIndex } from "../features/mobile-capture/capture-store";
import { collectOperationRowsFromBlocks } from "../features/network-graph/plan-flow";
import { stripDocKeyPrefix } from "../features/prov-export/note-export";
import type { StepInfo } from "./note-text";

/** 1 回の返り値に入れるメモの上限（超えた分は件数だけ伝える） */
export const NOTE_MEMO_LIMIT = 100;
/** メモ 1 件の本文の上限（文字数） */
export const NOTE_MEMO_TEXT_LIMIT = 1000;

export type NoteMemoTarget =
  | { kind: "edge"; graph: "steps" | "plan"; from: string; to: string; fromName: string; toName: string }
  | { kind: "block"; blockId: string; blockText?: string; stepBlockId?: string; stepTitle?: string }
  | { kind: "note" };

export type NoteMemo = {
  id: string;
  text: string;
  /** 作成日（YYYY-MM-DD。日時が読めなければ空） */
  date: string;
  target: NoteMemoTarget;
};

export type NoteMemos = {
  memos: NoteMemo[];
  /** 上限を超えて返さなかった件数 */
  omitted: number;
};

type DocLike = { pages?: { blocks?: any[]; tableMeta?: any }[] };

/** 改行の種類をそろえる（\r・行区切り文字が字下げをすり抜けて、行頭から見出しや箇条書きを作らないように） */
function normalizeBreaks(text: unknown): string {
  return typeof text === "string" ? text.replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n") : "";
}

/** 名前・抜粋は 1 行にする（付け先の名前に改行が入っても、出力の構造を崩さない） */
function oneLine(text: unknown, max = 80): string {
  const one = normalizeBreaks(text).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function clip(text: unknown): string {
  const trimmed = normalizeBreaks(text).trim();
  return trimmed.length > NOTE_MEMO_TEXT_LIMIT ? `${trimmed.slice(0, NOTE_MEMO_TEXT_LIMIT)}…（以下略）` : trimmed;
}

function dateOf(iso: unknown): string {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "";
}

/**
 * このノートに付いたメモを、作成順に集める。上限を超えたら新しいほうを残す
 * （次の計画に効くのは新しいメモ。古いほうは件数だけ伝える）。
 * 端点の名前は今の手順名・工程名を優先し、消えた端点は作成時の名前（スナップショット）で残す。
 *
 * captures.json は外で書き換えられうるので、形の崩れた項目は読み飛ばす。それでも組み立てに
 * 失敗したら「メモ無し」を返す（メモのせいで、ノートの読み出しそのものを落とさない）。
 */
export function collectNoteMemos(
  noteId: string,
  doc: DocLike,
  steps: StepInfo[],
  captureIndex: CaptureIndex | null,
): NoteMemos {
  try {
    return collect(noteId, doc, steps, captureIndex);
  } catch {
    return { memos: [], omitted: 0 };
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function collect(noteId: string, doc: DocLike, steps: StepInfo[], captureIndex: CaptureIndex | null): NoteMemos {
  const ownKey = stripDocKeyPrefix(noteId);
  const all: unknown = captureIndex?.captures;
  const own = (Array.isArray(all) ? all : []).filter(
    (c: CaptureEntry | null) =>
      !!c &&
      typeof c === "object" &&
      typeof c.id === "string" &&
      !c.archivedAt &&
      !c.deletedAt &&
      typeof c.sourceNote?.fileId === "string" &&
      stripDocKeyPrefix(c.sourceNote.fileId) === ownKey,
  ) as CaptureEntry[];
  if (own.length === 0) return { memos: [], omitted: 0 };
  own.sort((a, b) => str(a.createdAt).localeCompare(str(b.createdAt)));
  const omitted = Math.max(0, own.length - NOTE_MEMO_LIMIT);

  const stepTitle = new Map(steps.map((s) => [s.blockId, s.title]));
  // ブロック → それを含む手順。入れ子の手順は後ろに並ぶので、後勝ちで一番内側の手順になる
  const stepOfBlock = new Map<string, string>();
  for (const s of steps) {
    stepOfBlock.set(s.blockId, s.blockId);
    for (const id of s.childBlockIds) stepOfBlock.set(id, s.blockId);
  }
  // 工程（計画ノートの表の行）の名前。工程のつながりのメモがあるときだけ読む
  let planNames: Map<string, string> | null = null;
  const planName = (rowId: string): string | undefined => {
    if (!planNames) {
      planNames = new Map();
      for (const page of doc.pages ?? []) {
        for (const row of collectOperationRowsFromBlocks(page?.blocks ?? [], page?.tableMeta)) {
          if (row.rowId) planNames.set(row.rowId, row.name);
        }
      }
    }
    return planNames.get(rowId);
  };

  const memos: NoteMemo[] = [];
  for (const c of own.slice(omitted)) {
    let target: NoteMemoTarget;
    if (c.sourceEdge && typeof c.sourceEdge === "object") {
      const e = c.sourceEdge;
      const graph = e.graph === "plan" ? "plan" : "steps";
      const nameOf = (id: unknown, label: unknown) =>
        oneLine((graph === "plan" ? planName(str(id)) : stepTitle.get(str(id))) || label) ||
        (graph === "plan" ? "（名前のない工程）" : "（名前のない手順）");
      target = {
        kind: "edge",
        graph,
        from: str(e.from),
        to: str(e.to),
        fromName: nameOf(e.from, e.fromLabel),
        toName: nameOf(e.to, e.toLabel),
      };
    } else if (typeof c.sourceNote?.blockId === "string" && c.sourceNote.blockId) {
      const blockId = c.sourceNote.blockId;
      const stepBlockId = stepOfBlock.get(blockId);
      const blockText = oneLine(c.sourceNote.blockText, 40);
      target = {
        kind: "block",
        blockId,
        ...(blockText ? { blockText } : {}),
        ...(stepBlockId ? { stepBlockId, stepTitle: oneLine(stepTitle.get(stepBlockId)) } : {}),
      };
    } else {
      target = { kind: "note" };
    }
    memos.push({ id: c.id, text: clip(c.text), date: dateOf(c.createdAt), target });
  }
  return { memos, omitted };
}

/** 複数行のメモを、箇条書きの続きとして読めるように字下げする */
function indentText(text: string, indent: string): string {
  return text.replace(/\n/g, `\n${indent}`);
}

function suffix(m: NoteMemo): string {
  return `  [memoId: ${m.id}${m.date ? ` / ${m.date}` : ""}]`;
}

/** 付け先の呼び名（get_note の一覧用） */
export function memoTargetLabel(target: NoteMemoTarget): string {
  if (target.kind === "edge") {
    return `${target.graph === "plan" ? "工程のつながり" : "手順のつながり"}「${target.fromName} → ${target.toName}」`;
  }
  if (target.kind === "block") {
    if (target.stepBlockId) {
      // 手順そのものに付けたメモと、手順の中のブロックに付けたメモを分ける
      const inner = target.blockId !== target.stepBlockId && target.blockText ? `の中「${target.blockText}」` : "";
      return `手順「${target.stepTitle || "（名前のない手順）"}」${inner}`;
    }
    return target.blockText ? `ブロック「${target.blockText}」` : `ブロック [blockId: ${target.blockId}]`;
  }
  return "ノート全体";
}

function omittedLine(omitted: number): string | null {
  return omitted > 0 ? `（ほかに、これより古いメモが ${omitted} 件あります。返していません）` : null;
}

/** get_note 用: このノートに付いたメモの一覧。メモが無ければ null */
export function formatNoteMemosSection({ memos, omitted }: NoteMemos): string | null {
  if (memos.length === 0) return null;
  const lines = memos.map((m) => `- ${memoTargetLabel(m.target)}: ${indentText(m.text, "  ")}${suffix(m)}`);
  const tail = omittedLine(omitted);
  return (
    `\n## このノートに付いたメモ（${memos.length + omitted} 件）\n` +
    `利用者が手順・つながり・ノートに書き添えたもの。毎回守ることも、その回だけの観察も、まだ確かめていない問いも混ざる。\n` +
    lines.join("\n") +
    (tail ? `\n${tail}` : "")
  );
}

export type StepMemoView = {
  /** 手順の blockId → その手順（と中のブロック）に付いたメモの行 */
  byStep: Map<string, string[]>;
  /** 手順のあとに置く節（つながりのメモ・残りの件数）。無ければ null */
  tail: string | null;
};

/** get_note_steps 用: 手順ごとのメモの行と、つながりのメモの節 */
export function formatStepMemos({ memos, omitted }: NoteMemos): StepMemoView {
  const byStep = new Map<string, string[]>();
  const edges: string[] = [];
  let others = 0;
  for (const m of memos) {
    if (m.target.kind === "edge") {
      edges.push(`- ${m.target.fromName} → ${m.target.toName}: ${indentText(m.text, "  ")}${suffix(m)}`);
    } else if (m.target.kind === "block" && m.target.stepBlockId) {
      const list = byStep.get(m.target.stepBlockId) ?? [];
      list.push(`   メモ: ${indentText(m.text, "         ")}${suffix(m)}`);
      byStep.set(m.target.stepBlockId, list);
    } else {
      others++;
    }
  }
  const parts: string[] = [];
  if (edges.length > 0) {
    parts.push(
      `## 手順のあいだに付いたメモ（${edges.length} 件）\n` +
        `前の手順から次の手順へ渡すところに書き添えたもの。\n` +
        edges.join("\n"),
    );
  }
  if (others > 0) parts.push(`（手順の外に付いたメモが ${others} 件あります。get_note で読めます）`);
  const more = omittedLine(omitted);
  if (more) parts.push(more);
  return { byStep, tail: parts.length > 0 ? parts.join("\n\n") : null };
}
