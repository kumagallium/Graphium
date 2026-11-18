// 表の列データの同値比較（純関数）
//
// setTableColumns が「中身が同じなら参照も変えない」ために使う。以前は丸ごと
// JSON.stringify して比べていたが、23 万行のデータ表では編集のたびに数百 MB の
// 文字列を 2 本作ることになり固まった。table-scope が大きな列を同じ参照で返し続ける
// ので、参照が同じ列は JSON 化せずに済ませる。

import type { TableColumnData, TableColumnsIndex, TableRowNamesIndex } from "./types";

function sameKeys(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameColumn(a: TableColumnData, b: TableColumnData): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 表の名前の集合と並び、各表の列名の集合と並びが同じで、各列のデータが
 * 「同じ参照」または「JSON が等しい」なら true
 */
export function tableColumnsEqual(a: TableColumnsIndex, b: TableColumnsIndex): boolean {
  if (a === b) return true;
  const tableNames = Object.keys(a);
  if (!sameKeys(tableNames, Object.keys(b))) return false;
  for (const tableName of tableNames) {
    const colsA = a[tableName];
    const colsB = b[tableName];
    if (colsA === colsB) continue;
    const columnNames = Object.keys(colsA);
    if (!sameKeys(columnNames, Object.keys(colsB))) return false;
    for (const columnName of columnNames) {
      if (!sameColumn(colsA[columnName], colsB[columnName])) return false;
    }
  }
  return true;
}

/**
 * 行の名前（表示名 → 1 列目のテキストの並び）の同値比較。表の名前の集合と並びが同じで、
 * 各表の並びが「同じ参照」または「要素がすべて等しい」なら true
 */
export function tableRowNamesEqual(a: TableRowNamesIndex, b: TableRowNamesIndex): boolean {
  if (a === b) return true;
  const tableNames = Object.keys(a);
  if (!sameKeys(tableNames, Object.keys(b))) return false;
  for (const tableName of tableNames) {
    const rowsA = a[tableName];
    const rowsB = b[tableName];
    if (rowsA !== rowsB && !sameKeys(rowsA, rowsB)) return false;
  }
  return true;
}
