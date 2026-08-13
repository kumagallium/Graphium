// テーブル注釈（tableMeta）のヘルパー
//
// 「テーブルの種類」ではなく「列の種類」で表現する（docs/internal/table-column-properties-design.md）。
// 記録テーブル・インデックステーブルという 2 つの種類は、実体としてはどちらも
// 「1 列目のふるまい」だった。種類を増やす代わりに列へふるまいを注釈する形に
// 一般化することで、テーブル自体は 1 種類に戻る。
//
// データは今後もただの Markdown テーブル（セルは文字列）で、名前と列のふるまいだけを
// この注釈層に持つ。書き出せば普通の表として残る — Notion の「アプリ専用 DB」とは
// ここで決定的に分かれる。
//
// 型そのものは他のサイドストア（mediaInlineLabels / mediaOcr）と揃えて
// lib/document-types.ts に置いている。

import type { ColumnType, TableMeta } from "../../lib/document-types";

export type { ColumnType, TableMeta };

/** その型のふるまいを持つ列があるか */
export function hasColumnType(
  meta: TableMeta | undefined,
  type: ColumnType
): boolean {
  if (!meta?.columns) return false;
  return Object.values(meta.columns).some((types) => types.includes(type));
}

/** その型のふるまいが付いている列名（複数あれば最初の 1 つ）。無ければ undefined */
export function findColumnNameByType(
  meta: TableMeta | undefined,
  type: ColumnType
): string | undefined {
  if (!meta?.columns) return undefined;
  for (const [name, types] of Object.entries(meta.columns)) {
    if (types.includes(type)) return name;
  }
  return undefined;
}

/** 列に 1 つのふるまいを足した columns を返す（既にあれば元のまま） */
export function withColumnType(
  columns: Record<string, ColumnType[]> | undefined,
  columnName: string,
  type: ColumnType
): Record<string, ColumnType[]> {
  const current = columns?.[columnName] ?? [];
  if (current.includes(type)) return { ...columns };
  return { ...columns, [columnName]: [...current, type] };
}

/** その型のふるまいを全列から外した columns を返す。空になった列は落とす */
export function withoutColumnType(
  columns: Record<string, ColumnType[]> | undefined,
  type: ColumnType
): Record<string, ColumnType[]> {
  const next: Record<string, ColumnType[]> = {};
  for (const [name, types] of Object.entries(columns ?? {})) {
    const kept = types.filter((t) => t !== type);
    if (kept.length > 0) next[name] = kept;
  }
  return next;
}

/** 中身が空（保存する意味が無い）か。空エントリを残さないための判定 */
export function isTableMetaEmpty(meta: TableMeta | undefined): boolean {
  if (!meta) return true;
  if (meta.caption && meta.caption.length > 0) return false;
  if (meta.columns && Object.keys(meta.columns).length > 0) return false;
  if (meta.noteLinks && Object.keys(meta.noteLinks).length > 0) return false;
  return true;
}
