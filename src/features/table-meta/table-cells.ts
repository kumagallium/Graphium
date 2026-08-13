// テーブルブロックのセル読み取り
//
// BlockNote のテーブルセルは、新しい `tableCell` 形式と旧 inline 配列形式の
// 両方がありうる（既存ノートには両方が混在する）。読み取りはこの 1 箇所に集める。

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
