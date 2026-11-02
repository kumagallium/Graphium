// メモを BlockNote ノートに挿入するときのブロック表現を組み立てる。
//
// 仕様（メモの引用ブロック化後）:
//   - メモは常に BlockNote 標準の **quote ブロック 1 個** になる（出典なしのメモも）。
//   - 出典付きメモ（テキスト末尾に `\n\n— <source>` を含む）は、本文と出典を inline で並べ、
//     出典は italic + gray で控えめに見せる。
//   - 本文の改行（`\n`）は text の "\n" のまま残す。BlockNote 0.56 の quote は "\n" を改行
//     （hardBreak）として保持し、保存・読み込みでも保たれる（features/memo-quote/insert-memo-quote.test.ts で確認済み）。
//
// 紐づけ（どのメモの写しか）はブロックには持たせず、ページの memoQuotes に置く
// （features/memo-quote）。この関数はブロックの形だけを作る。

import type { CaptureEntry } from "./capture-store";

/**
 * BlockNote の InlineContent に相当する最小型。
 * 実コードでは BlockNote の型に依存しないよう緩く定義しているが、
 * 構造は `{ type: "text", text, styles }` で互換。
 */
export type MemoInlineContent = {
  type: "text";
  text: string;
  styles: Record<string, unknown>;
};

export type MemoInsertBlock = {
  type: "quote";
  content: MemoInlineContent[];
};

/** 出典セパレータ。Quote→Memo は `${本文}\n\n— ${出典}` で保存している。 */
const SOURCE_SEP = "\n\n— ";

/**
 * メモテキストを本文と出典ラベルに分割する。
 * セパレータが含まれない場合は `body` のみ・`source` は null。
 */
export function splitMemoBodyAndSource(text: string): {
  body: string;
  source: string | null;
} {
  const idx = text.lastIndexOf(SOURCE_SEP);
  if (idx < 0) return { body: text, source: null };
  const body = text.slice(0, idx);
  // ` — ` プレフィックスは出典装飾として inline 側で付け直すので、ここでは外す
  const source = text.slice(idx + SOURCE_SEP.length);
  return { body, source };
}

/**
 * 本文の改行コードを "\n" にそろえて前後の空白を落とす。
 * 段落区切り（`\n\n`）・段落内改行（`\n`）はそのまま残す（quote の改行として表示される）。
 */
function normalizeBody(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

/**
 * メモ 1 件を、ノートに挿入する quote ブロックに変換する。
 *
 * - 本文 inline + 「— 出典」inline（italic + gray）。本文が 1 行なら本文の後ろに空白をはさんで
 *   並べ、本文が複数行なら出典は最後に改行して置く。
 * - 出典なしは本文 inline だけ。
 *
 * 空メモは null を返す（呼び出し側で挿入をスキップする想定）。
 */
export function buildMemoInsertBlock(entry: CaptureEntry): MemoInsertBlock | null {
  const { body, source } = splitMemoBodyAndSource(entry.text);
  const text = normalizeBody(body);
  if (!text && !source) return null;

  const content: MemoInlineContent[] = [];
  if (text) {
    content.push({ type: "text", text, styles: {} });
  }
  if (source) {
    const lead = !text ? "" : text.includes("\n") ? "\n" : " ";
    content.push({
      type: "text",
      text: `${lead}— ${source}`,
      styles: { italic: true, textColor: "gray" },
    });
  }
  return { type: "quote", content };
}
