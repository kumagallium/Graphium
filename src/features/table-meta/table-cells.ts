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
