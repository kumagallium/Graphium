// データ表ブロックの純ロジック
//
// ブロックは素材（区切りテキスト）への参照と読み方だけを props に持ち、行の実体は
// 持たない。ここは props の読み書きと、表示のための計算（列幅・数値列の判定・
// 見えている行の範囲・並べ替え順）を純関数で置く。描画（view.tsx）と Markdown
// 書き出し（to-markdown.ts）が同じ計算を使う。

import type { TableSource } from "../../lib/document-types";
import {
  isNumericColumn,
  sortRowOrder,
  type SortState,
} from "../../features/table-meta/sort-table";

/** 1 データ行の高さ（px）。固定にするのは仮想スクロールで行位置を計算で出すため */
export const ROW_HEIGHT = 28;
/** 見出し行の高さ（px） */
export const HEADER_HEIGHT = 30;
/** 一度に見せる行数。これを超えるとブロック内でスクロールする */
export const VISIBLE_ROWS = 12;
/** 見えている範囲の前後に余分に描く行数（スクロール中の白抜けを防ぐ） */
export const OVERSCAN_ROWS = 8;
/** 行番号列の幅（px） */
export const INDEX_COLUMN_WIDTH = 48;
export const MIN_COLUMN_WIDTH = 72;
export const MAX_COLUMN_WIDTH = 320;
/** 列幅を決めるときに見る行数。全行を見ると巨大ファイルで無駄に重い */
const WIDTH_SAMPLE_ROWS = 200;
/** 13px の英数字 1 文字あたりの概算幅（px） */
const CHAR_WIDTH = 7.4;
/** セル左右の余白の合計（px） */
const CELL_PADDING = 20;

// 取り込みの既定の行き先（features/data-import/target）。ホスト向けにここからも出す
export { DOC_TABLE_DEFAULT_MAX_ROWS, defaultImportTarget } from "../../features/data-import/target";

/** props.source（JSON 文字列）→ TableSource。壊れていれば null */
export function parseDataTableSource(raw: unknown): TableSource | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    if (typeof value.fileName !== "string") return null;
    if (!value.options || typeof value.options !== "object") return null;
    const options = value.options;
    if (typeof options.headerRow !== "number" || typeof options.endRow !== "number") return null;
    return value as TableSource;
  } catch {
    return null;
  }
}

/** TableSource → props.source（JSON 文字列） */
export function serializeDataTableSource(source: TableSource): string {
  return JSON.stringify(source);
}

/** 読み方から見積もる行数（見出し行を除く）。素材を読む前の表示用 */
export function estimateRowCount(source: TableSource): number | null {
  const { headerRow, endRow } = source.options;
  if (!Number.isFinite(headerRow) || !Number.isFinite(endRow)) return null;
  return Math.max(0, endRow - headerRow);
}

export type ColumnModel = {
  /** 列幅（px）。見出しと先頭 WIDTH_SAMPLE_ROWS 行の最長セルから決める */
  width: number;
  /** 数値列なら右寄せ・等幅数字で描く */
  numeric: boolean;
};

/** 列ごとの見た目（幅・数値列か）を決める */
export function buildColumnModels(headers: string[], rows: string[][]): ColumnModel[] {
  const sample = rows.length > WIDTH_SAMPLE_ROWS ? rows.slice(0, WIDTH_SAMPLE_ROWS) : rows;
  return headers.map((header, col) => {
    let maxChars = header.length;
    for (const row of sample) {
      const len = (row[col] ?? "").length;
      if (len > maxChars) maxChars = len;
    }
    const width = Math.min(
      MAX_COLUMN_WIDTH,
      Math.max(MIN_COLUMN_WIDTH, Math.ceil(maxChars * CHAR_WIDTH + CELL_PADDING)),
    );
    return { width, numeric: isNumericColumn(sample, col) };
  });
}

/** 表全体の幅（行番号列込み、px） */
export function tableWidth(columns: ColumnModel[]): number {
  return INDEX_COLUMN_WIDTH + columns.reduce((sum, c) => sum + c.width, 0);
}

/**
 * スクロール位置から描くべき行の範囲 [start, end) を返す。
 * 前後に OVERSCAN_ROWS 行の余裕を持たせる。
 */
export function visibleRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / ROW_HEIGHT);
  const visible = Math.ceil(Math.max(0, viewportHeight) / ROW_HEIGHT) + 1;
  const start = Math.max(0, first - OVERSCAN_ROWS);
  const end = Math.min(rowCount, first + visible + OVERSCAN_ROWS);
  return { start, end };
}

/** 表示順（元 index の並び）。sort が無ければそのままの順 */
export function orderRows(rows: string[][], sort: SortState): number[] {
  if (!sort) return rows.map((_, i) => i);
  return sortRowOrder(rows, sort);
}

/** 表の高さ（px）。見出し + 見えている行数ぶん */
export function viewportHeightFor(rowCount: number): number {
  return HEADER_HEIGHT + Math.min(Math.max(rowCount, 1), VISIBLE_ROWS) * ROW_HEIGHT;
}
