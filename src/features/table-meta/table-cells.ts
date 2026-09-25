// テーブルブロックのセル読み取り
//
// BlockNote のテーブルセルは、新しい `tableCell` 形式と旧 inline 配列形式の
// 両方がありうる（既存ノートには両方が混在する）。読み取りはこの 1 箇所に集める。

import { TABLE_ROW_IDENTITY_STYLE, tableRowIdentityOfCell } from "../../lib/table-row-identity";

/** セルからテキストを取り出す */
export function readCellText(cell: any): string {
  const content = Array.isArray(cell)
    ? cell
    : cell?.type === "tableCell"
      ? (cell.content ?? [])
      : null;
  if (!content) return "";
  return content
    .map((c: any) => (c?.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
}

/**
 * テーブルブロックの先頭列の名前（ヘッダ行の 1 列目）。
 * ヘッダが空のテーブルもあるため、取れなければ空文字を返す。
 */
export function readFirstColumnName(block: any): string {
  if (block?.type !== "table") return "";
  const headerCells = (block.content?.rows ?? [])[0]?.cells ?? [];
  return readCellText(headerCells[0]);
}

/** blocks を再帰的に走査して table ブロックを blockId → block で集める */
export function collectTableBlocks(blocks: any[]): Map<string, any> {
  const found = new Map<string, any>();
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && typeof b.id === "string") found.set(b.id, b);
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return found;
}

/**
 * テーブルブロックの中身を「ヘッダ + データ行」の文字列二次元配列として読む。
 * 拡大表示（モーダル）用のスナップショット。
 *
 * 列数はヘッダ行とデータ行の最大に揃える — 見出しに合わせて切り詰めると、
 * 見出しより列が多い行の値が黙って消える（データ取り込みで踏んだ罠と同じ）。
 */
export function readTableData(block: any): { header: string[]; rows: string[][] } | null {
  if (block?.type !== "table") return null;
  const rawRows: any[] = block.content?.rows ?? [];
  if (rawRows.length === 0) return null;
  const cellRows = rawRows.map((r) => (r?.cells ?? []).map((c: any) => readCellText(c)));
  const colCount = Math.max(...cellRows.map((r) => r.length), 1);
  const pad = (r: string[]) =>
    r.length >= colCount ? r : [...r, ...Array(colCount - r.length).fill("")];
  const [header, ...rows] = cellRows.map(pad);
  return { header, rows };
}

/**
 * セルの中身を 1 つのテキストに差し替える。`tableCell` 形式なら props（背景色・
 * 結合・配置）を残したまま content だけ入れ替える。旧 inline 配列形式は配列で返す。
 *
 * セルを `[{type:"text", ...}]` で丸ごと置き換えると、その形式の違いのぶん
 * セルに付いていた色・配置が黙って落ちる。書き換えはこの 1 箇所に集める。
 *
 * 先頭列のセルには行の同一性（tableRowIdentity）が付いている。書き換えで落とすと
 * 次の保存でその行が別の Entity として採番し直され、行に紐づくもの（他ノートからの
 * 行の参照・行ごとの @リンク）が外れる。元のセルに付いていれば新しい文字へ引き継ぐ
 */
export function withCellText(
  cell: any,
  text: string,
  styles: Record<string, unknown> = {}
): any {
  const identity = text ? tableRowIdentityOfCell(cell) : undefined;
  const content = [
    { type: "text", text, styles: identity ? { ...styles, [TABLE_ROW_IDENTITY_STYLE]: identity } : styles },
  ];
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

/**
 * ヘッダ行のテキストで列の位置を引く。列のふるまい（tableMeta.columns）は
 * 列名で持っているため、位置に直すのはここを通す。
 * 見つからなければ 0 — インデックステーブルは先頭列を行の名前に使う。
 */
export function findColumnIndexByName(block: any, columnName: string | undefined): number {
  if (!columnName) return 0;
  const headerCells = (block?.content?.rows ?? [])[0]?.cells ?? [];
  const idx = headerCells.findIndex((c: any) => readCellText(c) === columnName);
  return idx >= 0 ? idx : 0;
}
