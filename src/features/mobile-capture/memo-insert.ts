// メモを BlockNote ノートに挿入するときのブロック表現を組み立てる。
//
// 仕様（PR3-a 後）:
//   - 出典付きメモ（テキスト末尾に `\n\n— <source>` を含む）
//     → BlockNote 標準の **quote ブロック 1 個** に、本文と出典を inline で並べる。
//        出典は italic + gray で控えめに見せる。
//   - 出典なしメモ → 従来通り単一 paragraph で挿入。
//
// quote ブロックの content は "inline" 型なので段落内改行は表現できない。
// 本文の段落区切り（`\n\n`）は半角スペースに丸め、1 行のインラインフローに収める。

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
  type: "quote" | "paragraph";
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
 * 段落区切り（`\n\n`）と段落内改行（`\n`）を半角スペースに丸めて、
 * 1 行のインラインフローにする。
 *
 * 厳密には CJK 同士なら詰めたいところだが、メモは PdfViewer 側で
 * 既に normalize 済みのことが多く、ここでは保守的にスペース化する。
 */
function flattenToInline(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * メモ 1 件を、ノートに挿入する単一ブロックに変換する。
 *
 * - 出典あり: quote ブロック 1 個。本文 inline + 「 — 出典」inline（italic + gray）。
 * - 出典なし: paragraph 1 個。本文 inline のみ。
 *
 * 空メモは null を返す（呼び出し側で挿入をスキップする想定）。
 */
export function buildMemoInsertBlock(entry: CaptureEntry): MemoInsertBlock | null {
  const { body, source } = splitMemoBodyAndSource(entry.text);
  const flatBody = flattenToInline(body);
  if (!flatBody && !source) return null;

  if (source) {
    const content: MemoInlineContent[] = [];
    if (flatBody) {
      content.push({ type: "text", text: flatBody, styles: {} });
    }
    content.push({
      type: "text",
      text: `${flatBody ? " " : ""}— ${source}`,
      styles: { italic: true, textColor: "gray" },
    });
    return { type: "quote", content };
  }

  return {
    type: "paragraph",
    content: [{ type: "text", text: flatBody, styles: {} }],
  };
}
