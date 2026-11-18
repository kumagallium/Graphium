// データ素材プレビューの表への変換
//
// プレビューは並べ替えのために全行を持つ。本文が大きいと、一息の変換でアプリが
// 固まるので、SYNC_PARSE_MAX_CHARS を超えるときは小分けの非同期で変換する
// （結果は同期版と同じ）。小さい本文は今までどおり同期で変換する。

import { SYNC_PARSE_MAX_CHARS } from "../data-import/large-file";
import { parseDelimited, parseDelimitedLinesAsync } from "../data-import/parse";
import type { DelimitedImportOptions, ParsedDelimited } from "../data-import/types";

/** 本文 → 表。lines は splitLines(text) の結果（大きい本文で分割し直さないため受け取る） */
export function parsePreviewText(
  text: string,
  lines: string[],
  options: DelimitedImportOptions
): Promise<ParsedDelimited> {
  if (text.length > SYNC_PARSE_MAX_CHARS) return parseDelimitedLinesAsync(lines, options);
  return Promise.resolve(parseDelimited(text, options));
}

// 表示する行数・列数の上限は Excel のプレビューと同じ（巨大な表で描画を止めない）
import { XLSX_PREVIEW_MAX_COLS, XLSX_PREVIEW_MAX_ROWS } from "./OfficePreview";

/**
 * 表示用に行・列を上限で切る。上限以下ならそのまま（同じ配列）返す。
 * 並べ替えは切ったあとの行に対して行う（Excel のプレビューと同じ流儀）
 */
export function limitPreviewTable(
  headers: string[],
  rows: string[][]
): { header: string[]; rows: string[][]; cut: boolean } {
  const colsOver = headers.length > XLSX_PREVIEW_MAX_COLS;
  const rowsOver = rows.length > XLSX_PREVIEW_MAX_ROWS;
  if (!colsOver && !rowsOver) return { header: headers, rows, cut: false };
  const header = colsOver ? headers.slice(0, XLSX_PREVIEW_MAX_COLS) : headers;
  const shownRows = rowsOver ? rows.slice(0, XLSX_PREVIEW_MAX_ROWS) : rows;
  return {
    header,
    rows: colsOver ? shownRows.map((r) => r.slice(0, XLSX_PREVIEW_MAX_COLS)) : shownRows,
    cut: true,
  };
}
