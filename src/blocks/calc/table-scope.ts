// 計算ブロックから参照できる「表の列」を集める
//
//   合計 = sum(table["秤量表"]["質量"])
//   合計 = sum(col("秤量表", "質量"))     // 同じ意味の短い書き方
//
// のように、表の列を式から読めるようにする。表の名前は表示名
// （キャプション / 文書順の自動名「表 N」）で、無名の表も自動名で参照できる。
//
// 設計の決め事:
// - **表は素の Markdown のまま**。式も結果も表には書き込まない（tableMeta の方針）。
//   参照は評価時に片方向で解決するだけで、表側には何の痕跡も残さない
// - 表の名前は既存の表示名（tableMeta.caption / 「表 N」の自動名）をそのまま使う。
//   参照のための新しい名前空間は作らない
// - 値の読み方はチャートと同じ推定（parseNumeric）。単位付き・全角・桁区切りを許容し、
//   読めないセルは飛ばす。「数値列」という型をユーザーに宣言させない
// - **列内で単位表記が揃っていれば unit として残す**（`1 g` と `2 g` → unit "g"）。
//   評価側（engine）が mathjs の単位付き数量に変換し、`sum` が `3 g` を返せるようにする。
//   揃っていない・単位が無い列は素の数値になる
// - **記法は文字列キーに限る**。mathjs のパーサは ASCII の識別子しか受け付けず、
//   `秤量表.質量` のようなドット記法は日本語名だと構文エラーになる（実測）。
//   そのため `表["秤量表"]["質量"]` と `col("秤量表", "質量")` の 2 つを入口にする

import { normalizeNumericText, parseNumeric } from "../chart/chart-data";
import { readCellText } from "../../features/table-meta/table-cells";
import { computeTableDisplayNames } from "../../features/table-meta/auto-name";
import type {
  TableColumnData,
  TableColumnsIndex,
} from "../../features/table-meta/types";

/** 表示名 → その表の列（列名 → 列データ） */
export type TableColumns = Map<string, Map<string, TableColumnData>>;

/** 正規化済みセルテキストから、数値部分を除いた残り（単位表記）を返す */
function unitTextOf(raw: string): string {
  const s = normalizeNumericText(raw);
  const m = s.match(/^[+-]?\d+(\.\d+)?/);
  if (!m) return "";
  return s.slice(m[0].length).trim();
}

/**
 * 表ブロックを「列名 → 列データ」に読む。
 * 1 行目をヘッダとして扱い、同名の列は最初の 1 つを採る。
 */
export function readTableColumns(block: any): Map<string, TableColumnData> {
  const columns = new Map<string, TableColumnData>();
  const rows: any[] = block?.content?.rows ?? [];
  if (rows.length < 2) return columns;
  const headers = (rows[0].cells ?? []).map((c: any) => readCellText(c));
  headers.forEach((header: string, col: number) => {
    const name = header.trim();
    if (!name || columns.has(name)) return;
    const values: number[] = [];
    let unit: string | undefined;
    let unitConsistent = true;
    for (let r = 1; r < rows.length; r++) {
      const raw = readCellText(rows[r].cells?.[col]);
      const value = parseNumeric(raw);
      if (value === null) continue;
      values.push(value);
      const u = unitTextOf(raw);
      if (unit === undefined) unit = u;
      else if (unit !== u) unitConsistent = false;
    }
    const data: TableColumnData = { values };
    // 数値の読めた全セルで単位表記が一致したときだけ単位として扱う。
    // 混在（"1 g" と "2 kg"）は誤変換の方が怖いので素の数値に落とす
    if (unitConsistent && unit) data.unit = unit;
    columns.set(name, data);
  });
  return columns;
}

/**
 * 文書中の表を表示名付きで集める。displayNames は
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

/** ストア配布・評価に使う素の入れ子オブジェクトにする */
export function buildTableIndex(tables: TableColumns): TableColumnsIndex {
  const index: TableColumnsIndex = {};
  for (const [tableName, columns] of tables) {
    index[tableName] = Object.fromEntries(columns);
  }
  return index;
}

/**
 * ホスト（実エディタを持つ側）が呼ぶ: いまの本文から表の列を読み、
 * tableMeta ストアに置く。計算ブロックはストアから読む — ブロックの render に
 * 渡る editor.document は描画時点のスナップショットで古くなるため（実測）、
 * 生きた中身はこの経路でしか届けられない。
 */
export function publishTableColumns(
  editor: any,
  store: {
    getCaption: (blockId: string) => string;
    setTableColumns: (columns: TableColumnsIndex) => void;
  } | null | undefined,
): void {
  const doc = editor?.document;
  if (!Array.isArray(doc) || !store) return;
  const displayNames = computeTableDisplayNames(doc, store.getCaption);
  store.setTableColumns(buildTableIndex(collectTableColumns(doc, displayNames)));
}
