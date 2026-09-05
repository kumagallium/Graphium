// 取り込んだデータの行き先（文書の表 / データ表）の既定
//
// 純関数だけを置く。取り込みダイアログ（features）とデータ表ブロック（blocks）の
// 両方が使うので、どちらにも寄せずここに置く。

import type { ImportTarget } from "./types";

/**
 * 文書の表として入れる既定の上限行数。これを超えると取り込みの既定はデータ表になる。
 *
 * 根拠: ノート本文の表は編集のたびに文書全体を直列化するので、行数にそのまま比例して
 * 重くなる。2,000 行の表を入れた直後に編集が止まった実測（2026-09-04）から、余裕を
 * 見て 1 桁下に置く。上限ではなく「既定の振り分け」なので、越えても文書の表は選べる。
 */
export const DOC_TABLE_DEFAULT_MAX_ROWS = 200;

/** 取り込みの既定の行き先。行数だけで決める（列数は編集の重さにほとんど効かない） */
export function defaultImportTarget(rowCount: number): ImportTarget {
  return rowCount > DOC_TABLE_DEFAULT_MAX_ROWS ? "dataTable" : "table";
}
