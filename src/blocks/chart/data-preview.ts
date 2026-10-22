// データピッカー用の中身の下見（純関数）
//
// 素材の本文を取り込みダイアログと同じ規則（行分割 → 読み方の自動判定 → 区切り読み）で
// 表にし、「グラフにできるか」「何の列があるか」「どんな形の線か」だけを返す。
// キャッシュは持たない（ピッカー側が fileId 単位で持つ）。

import { splitLines, parseDelimited } from "../../features/data-import/parse";
import { detectImportOptions } from "../../features/data-import/detect";
import { isNumericColumn, parseNumeric, type TableData } from "./chart-data";

export type DataPreview = {
  /** 見出し（列名） */
  headers: string[];
  /** データ行数 */
  rowCount: number;
  /** 数値として読める列の名前 */
  numericColumns: string[];
  /** 線の形（最大 SPARKLINE_MAX_POINTS 点に間引いた値） */
  sparkline: number[];
  /** 数値列があり、チャートにできるか */
  usable: boolean;
};

/** 下見の線に使う最大点数 */
export const SPARKLINE_MAX_POINTS = 48;

/** 端点を含めて等間隔に max 点へ間引く */
function downsample(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    out.push(values[Math.round((i * (values.length - 1)) / (max - 1))]);
  }
  return out;
}

/** 下見の判定に使う本文の上限（これを超える分は読まない。UI を止めないため） */
export const PREVIEW_MAX_CHARS = 256 * 1024;

/** text 中の改行（\n）の数。全文を split せず indexOf で数える */
function countNewlines(text: string, from: number): number {
  let n = 0;
  let i = text.indexOf("\n", from);
  while (i !== -1) {
    n++;
    i = text.indexOf("\n", i + 1);
  }
  return n;
}

export function analyzeDataText(fullText: string): DataPreview {
  // 巨大ファイルは先頭だけで判定する（最後の改行で切る）。行数は残りの改行数で近似
  let text = fullText;
  let restRows = 0;
  if (fullText.length > PREVIEW_MAX_CHARS) {
    const cut = fullText.lastIndexOf("\n", PREVIEW_MAX_CHARS);
    const end = cut > 0 ? cut : PREVIEW_MAX_CHARS;
    text = fullText.slice(0, end);
    // 残り本文の行数。末尾が改行で終わらない最後の行も 1 行として数える
    restRows = countNewlines(fullText, end + 1);
    if (!fullText.endsWith("\n") && fullText.length > end + 1) restRows++;
  }
  const lines = splitLines(text);
  const parsed = parseDelimited(text, detectImportOptions(lines));
  const table: TableData = { headers: parsed.headers, rows: parsed.rows };
  const headers = table.headers;

  // 空の見出しは列として扱わない
  const numericColumns = headers.filter(
    (h) => h.trim() !== "" && isNumericColumn(table, h)
  );

  // 線にする列: 先頭列（X 想定）以外の最初の数値列。無ければ最初の数値列
  const lineColumn =
    numericColumns.find((c) => c !== headers[0]) ?? numericColumns[0];
  let sparkline: number[] = [];
  if (lineColumn !== undefined) {
    const idx = headers.indexOf(lineColumn);
    const values: number[] = [];
    for (const row of table.rows) {
      const n = parseNumeric(row[idx] ?? "");
      if (n !== null) values.push(n);
    }
    sparkline = downsample(values, SPARKLINE_MAX_POINTS);
  }

  return {
    headers,
    rowCount: table.rows.length + restRows,
    numericColumns,
    sparkline,
    usable: numericColumns.length > 0,
  };
}
