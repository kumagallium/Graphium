// データ表ブロックの props.source（TableSource の JSON）の読み書き
//
// 依存の無い葉モジュール。features 側（自動命名・列公開・usedIn）からも読むので、
// React やソート実装（sort-table → chart-data）を巻き込まない場所に置く。

import type { TableSource } from "../../lib/document-types";
import { defaultCaption } from "../../features/data-import/to-table-block";

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

/**
 * データ表の表示名。キャプションがあればそれ、無ければ元ファイル名（拡張子なし）。
 * 計算ブロック・チャートはこの名前で参照する（本文の表のキャプションと同じ規則）。
 */
export function dataTableDisplayName(caption: unknown, source: TableSource | null): string {
  const trimmed = typeof caption === "string" ? caption.trim() : "";
  if (trimmed) return trimmed;
  return source ? defaultCaption(source.fileName) : "";
}

/** ブロック（BlockNote の JSON）から表示名を引く。dataTable でなければ "" */
export function dataTableDisplayNameOf(block: any): string {
  if (!block || block.type !== "dataTable") return "";
  return dataTableDisplayName(block.props?.caption, parseDataTableSource(block.props?.source));
}
