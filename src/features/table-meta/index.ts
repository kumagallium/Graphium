// テーブル注釈機能のエントリーポイント
//
// カスタムブロック型は使わず、標準 table ブロック + 外部ストアで実装する
// （テーブルは Markdown 書き出しでそのまま残る）。旧 log-table / index-table の
// 2 つのサイドストアはここに統合されている。

export {
  TableMetaStoreProvider,
  useTableMetaStore,
  useTableMetaStoreOptional,
} from "./store";
export type { TableMetaStoreValue } from "./store";
export { TableCaptionLayer } from "./caption-layer";
export { TableExpandModal } from "./expand-modal";
export { sortTableBlock } from "./sort-table";
export type { SortDir, SortState } from "./sort-table";
export type { TableExpandData } from "./expand-modal";
export { computeTableDisplayNames } from "./auto-name";
export { migrateTableMeta } from "./migration";
export { collectTableBlocks, readCellText, readFirstColumnName, readTableData } from "./table-cells";
export {
  findColumnNameByType,
  hasColumnType,
  isTableMetaEmpty,
  withColumnType,
  withoutColumnType,
} from "./types";
export type { ColumnType, TableMeta, TableSource } from "./types";
