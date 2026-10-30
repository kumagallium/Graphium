// 列ハンドル（⋮⋮）メニューに出す「列のふるまい」の付け外しの出し分け
//
// 行ごとのノート（note-link）は先頭列、日時（datetime-auto）は任意の列に付けられる。
// 同じ列に両方を付けると、行の名前（ノートのタイトルになる先頭列）が日時になってしまうので、
// 併用は新しく作れないようにする。旧データで既に両方が付いている列は、外す入口だけ残す。

import type { TableMeta } from "./types";
import { findColumnNameByType, hasColumnType } from "./types";

/**
 * メニュー項目の状態。enable = 付けられる（オフ）/ disable = 外せる（オン）/
 * blocked = 同じ列のもう一方がオンなので付けられない（薄く出して押せなくする —
 * 項目が消えると「この列では使えない」ことが伝わらない）/ null = 出さない
 */
export type ColumnBehaviorItem = "enable" | "disable" | "blocked" | null;

export type ColumnBehaviorMenuState = {
  dateTime: ColumnBehaviorItem;
  noteLink: ColumnBehaviorItem;
  /** 列の保護。見出しが空・重複の列には出さない（列のふるまいは列名で持つため） */
  protect: ColumnBehaviorItem;
};

/** 列名から列の位置を引く。見つからなければ 0（findColumnIndexByName と同じ） */
function resolveIndex(headers: string[], name: string | undefined): number {
  if (!name) return 0;
  const idx = headers.indexOf(name);
  return idx >= 0 ? idx : 0;
}

/**
 * colIndex の列のハンドルメニューに、日時・行ごとのノートの項目をどう出すか。
 * - 日時: 見出しが重複する列には出さない（列のふるまいは列名で持つため）。見出しが空の列には
 *   出す — 押したときに見出しへ名前を入れてから付ける（freeColumnName）。
 *   先頭列で行ごとのノートがオンなら blocked
 * - 行ごとのノート: 先頭列（colIndex === 0）だけ。日時が先頭列に付いていれば blocked
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
  if (columnName !== "" && headers.filter((h) => h === columnName).length > 1) {
    dateTime = null;
  } else if (dateTimeOn) {
    dateTime = "disable";
  } else if (colIndex === 0 && noteLinkOn) {
    dateTime = "blocked";
  } else {
    dateTime = "enable";
  }

  let noteLink: ColumnBehaviorItem;
  if (colIndex !== 0) {
    noteLink = null;
  } else if (noteLinkOn) {
    noteLink = "disable";
  } else if (dateTimeOnFirst) {
    noteLink = "blocked";
  } else {
    noteLink = "enable";
  }

  // 保護は列名で持つので、見出しが重複する列には出さない。見出しが空の列には出す — 押したときに
  // 見出しへ名前を入れてから付ける（日時と同じ。作った直後の表は見出しが空なので、出さないと
  // 保護だけが見当たらない）。計算が書き込む列も、ふつうのトグル
  // （手で付ければ列ごと保護。計算のセルは自動で保護されるので disabled にはしない）
  let protect: ColumnBehaviorItem = "enable";
  if (columnName !== "" && headers.filter((h) => h === columnName).length > 1) {
    protect = null;
  } else if (meta?.columns?.[columnName]?.includes("protected")) {
    protect = "disable";
  }

  return { dateTime, noteLink, protect };
}

/**
 * 見出しが空の列に日時を付けるときに入れる名前。base が空いていればそのまま、
 * 使われていれば「base 2」「base 3」… の最初の空き。
 */
export function freeColumnName(headers: string[], base: string): string {
  const used = new Set(headers);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
