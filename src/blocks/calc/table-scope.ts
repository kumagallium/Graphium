// 計算ブロックから参照できる「表の列」を集める
//
//   合計 = sum(表["秤量表"]["質量"])
//   合計 = sum(col("秤量表", "質量"))     // 同じ意味の短い書き方
//
// のように、名前を付けた表の列を式から読めるようにする。
//
// 設計の決め事:
// - **表は素の Markdown のまま**。式も結果も表には書き込まない（tableMeta の方針）。
//   参照は評価時に片方向で解決するだけで、表側には何の痕跡も残さない
// - 表の名前は既存の表示名（tableMeta.caption / 「表 N」の自動名）をそのまま使う。
//   参照のための新しい名前空間は作らない
// - 値の読み方はチャートと同じ推定（parseNumeric）。単位付き・全角・桁区切りを許容し、
//   読めないセルは飛ばす。「数値列」という型をユーザーに宣言させない
// - **記法は文字列キーに限る**。mathjs のパーサは ASCII の識別子しか受け付けず、
//   `秤量表.質量` のようなドット記法は日本語名だと構文エラーになる（実測）。
//   そのため `表["秤量表"]["質量"]` と `col("秤量表", "質量")` の 2 つを入口にする

import { parseNumeric } from "../chart/chart-data";
import { readCellText } from "../../features/table-meta/table-cells";
import { computeTableDisplayNames } from "../../features/table-meta/auto-name";

/** 表示名 → その表の列（列名 → 数値の配列） */
export type TableColumns = Map<string, Map<string, number[]>>;

/**
 * 表ブロックを「列名 → 数値の配列」に読む。
 * 1 行目をヘッダとして扱い、同名の列は最初の 1 つを採る。
 */
export function readTableColumns(block: any): Map<string, number[]> {
  const columns = new Map<string, number[]>();
  const rows: any[] = block?.content?.rows ?? [];
  if (rows.length < 2) return columns;
  const headers = (rows[0].cells ?? []).map((c: any) => readCellText(c));
  headers.forEach((header: string, col: number) => {
    const name = header.trim();
    if (!name || columns.has(name)) return;
    const values: number[] = [];
    for (let r = 1; r < rows.length; r++) {
      const value = parseNumeric(readCellText(rows[r].cells?.[col]));
      if (value !== null) values.push(value);
    }
    columns.set(name, values);
  });
  return columns;
}

/**
 * 文書中の「名前の付いた表」を集める。displayNames は
 * computeTableDisplayNames の結果（blockId → 表示名）。
 */
export function collectTableColumns(blocks: any[], displayNames: Map<string, string>): TableColumns {
  const tables: TableColumns = new Map();
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && typeof b.id === "string") {
        const name = displayNames.get(b.id);
        // 同じ名前の表が 2 つあるときは先に出てきた方を採る（文書順で安定させる）
        if (name && !tables.has(name)) tables.set(name, readTableColumns(b));
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return tables;
}

/**
 * `表["秤量表"]["質量"]` と書けるよう、素の入れ子オブジェクトにする。
 * mathjs は文字列キーの添字アクセスなら日本語でも通る（識別子だけが ASCII 限定）。
 */
export function buildTableIndex(tables: TableColumns): Record<string, Record<string, number[]>> {
  const index: Record<string, Record<string, number[]>> = {};
  for (const [tableName, columns] of tables) {
    index[tableName] = Object.fromEntries(columns);
  }
  return index;
}

/** `col("秤量表", "質量")` 用。無い表・無い列は理由の分かるエラーにする */
export function makeColumnLookup(tables: TableColumns) {
  return (tableName: unknown, columnName: unknown): number[] => {
    const table = tables.get(String(tableName));
    if (!table) throw new Error(`table not found: ${String(tableName)}`);
    const values = table.get(String(columnName));
    if (!values) throw new Error(`column not found: ${String(columnName)}`);
    return values;
  };
}

/**
 * ホスト（実エディタを持つ側）が呼ぶ: いまの本文から「名前付きの表の列」を読み、
 * tableMeta ストアに置く。計算ブロックはストアから読む — ブロックの render に
 * 渡る editor.document は描画時点のスナップショットで古くなるため（実測）、
 * 生きた中身はこの経路でしか届けられない。
 */
export function publishTableColumns(
  editor: any,
  store: {
    hasColumnType: (blockId: string, type: "datetime-auto" | "note-link") => boolean;
    getCaption: (blockId: string) => string;
    setTableColumns: (columns: Record<string, Record<string, number[]>>) => void;
  } | null | undefined,
): void {
  const doc = editor?.document;
  if (!Array.isArray(doc) || !store) return;
  const displayNames = computeTableDisplayNames(
    doc,
    (blockId: string) => store.hasColumnType(blockId, "datetime-auto"),
    store.getCaption,
  );
  store.setTableColumns(buildTableIndex(collectTableColumns(doc, displayNames)));
}
