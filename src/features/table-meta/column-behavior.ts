// 列ハンドル（⋮⋮）メニューに出す「列のふるまい」の付け外しの出し分け
//
// 行ごとのノート（note-link）は先頭列、日時（datetime-auto）は任意の列に付けられる。
// 同じ列に両方を付けると、行の名前（ノートのタイトルになる先頭列）が日時になってしまうので、
// 併用は新しく作れないようにする。旧データで既に両方が付いている列は、外す入口だけ残す。

import type { TableMeta } from "./types";
import { findColumnNameByType, hasColumnType } from "./types";

/** メニュー項目の状態。enable = 付ける入口 / disable = 外す入口 / null = 出さない */
export type ColumnBehaviorItem = "enable" | "disable" | null;

export type ColumnBehaviorMenuState = {
  dateTime: ColumnBehaviorItem;
  noteLink: ColumnBehaviorItem;
};

/** 列名から列の位置を引く。見つからなければ 0（findColumnIndexByName と同じ） */
function resolveIndex(headers: string[], name: string | undefined): number {
  if (!name) return 0;
  const idx = headers.indexOf(name);
  return idx >= 0 ? idx : 0;
}

/**
 * colIndex の列のハンドルメニューに、日時・行ごとのノートの項目をどう出すか。
 * - 日時: 見出しが空・重複の列には出さない（列のふるまいは列名で持つため）。
 *   先頭列で行ごとのノートがオンなら「入れる」は出さない
 * - 行ごとのノート: 先頭列（colIndex === 0）だけ。日時が先頭列に付いていれば「作る」は出さない
 */
export function columnBehaviorMenuState(
  headers: string[],
  meta: TableMeta | undefined,
  colIndex: number
): ColumnBehaviorMenuState {
  const columnName = headers[colIndex] ?? "";

  const dateTimeOn =
    hasColumnType(meta, "datetime-auto") &&
    resolveIndex(headers, findColumnNameByType(meta, "datetime-auto")) === colIndex;
  const dateTimeOnFirst =
    hasColumnType(meta, "datetime-auto") &&
    resolveIndex(headers, findColumnNameByType(meta, "datetime-auto")) === 0;
  const noteLinkOn = hasColumnType(meta, "note-link");

  let dateTime: ColumnBehaviorItem;
  if (!columnName || headers.filter((h) => h === columnName).length > 1) {
    dateTime = null;
  } else if (dateTimeOn) {
    dateTime = "disable";
  } else if (colIndex === 0 && noteLinkOn) {
    dateTime = null;
  } else {
    dateTime = "enable";
  }

  let noteLink: ColumnBehaviorItem;
  if (colIndex !== 0) {
    noteLink = null;
  } else if (noteLinkOn) {
    noteLink = "disable";
  } else if (dateTimeOnFirst) {
    noteLink = null;
  } else {
    noteLink = "enable";
  }

  return { dateTime, noteLink };
}
