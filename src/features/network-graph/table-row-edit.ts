// 構造化テーブル（material / tool / output ラベル付き table）の行を
// グラフ側から書き換えるユーティリティ。
//
// テーブル行 Entity（@id = entity_<tableBlockId>_<rowName>）の実体は
// ノート側テーブルの 1 行（1 列目 = Entity 名、以降の列 = 属性）。
// グラフのノードで名前や属性セルを編集する = ここを通って該当セルを
// 書き換える。行の特定は「1 列目のテキストが rowName に一致する最初の
// データ行」— 同名行が複数ある場合は最初の行だけが対象（既知の制限）。

/** セルからテキストを取り出す（generator の extractCellText と同じ 2 形式対応） */
function cellText(cell: any): string {
  const content = Array.isArray(cell) ? cell : cell?.type === "tableCell" ? (cell.content ?? []) : null;
  if (!content) return "";
  return content
    .map((c: any) => (c?.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
}

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストを差し替える */
function withCellText(cell: any, text: string): any {
  const content = [{ type: "text", text, styles: {} }];
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

type TableTarget = {
  block: any;
  rows: any[];
  headerCells: any[];
  rowIndex: number; // データ行の rows 内 index
};

/** tableBlockId のテーブルから rowName に一致する最初のデータ行を特定する */
function findTableRow(editor: any, tableBlockId: string, rowName: string): TableTarget | null {
  let block: any = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (block) return;
      if (b?.id === tableBlockId) {
        block = b;
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor?.document ?? []);
  if (!block || block.type !== "table") return null;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length < 2) return null;
  for (let i = 1; i < rows.length; i++) {
    if (cellText(rows[i].cells?.[0]) === rowName) {
      return { block, rows, headerCells: rows[0].cells ?? [], rowIndex: i };
    }
  }
  return null;
}

function writeRows(editor: any, block: any, rows: any[]): boolean {
  try {
    editor.updateBlock(block.id, { content: { ...block.content, rows } });
    return true;
  } catch {
    return false;
  }
}

/** 行の名前（1 列目）を書き換える */
export function renameTableRow(
  editor: any,
  tableBlockId: string,
  rowName: string,
  newName: string,
): boolean {
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const t = findTableRow(editor, tableBlockId, rowName);
  if (!t) return false;
  const rows = t.rows.map((row, i) =>
    i === t.rowIndex
      ? { ...row, cells: row.cells.map((c: any, j: number) => (j === 0 ? withCellText(c, trimmed) : c)) }
      : row,
  );
  return writeRows(editor, t.block, rows);
}

/** 属性セル（columnKey 列）の値を書き換える。ヘッダに列が無ければ no-op */
export function setTableCell(
  editor: any,
  tableBlockId: string,
  rowName: string,
  columnKey: string,
  value: string,
): boolean {
  const t = findTableRow(editor, tableBlockId, rowName);
  if (!t) return false;
  const colIndex = t.headerCells.findIndex((c: any, j: number) => j > 0 && cellText(c) === columnKey);
  if (colIndex < 0) return false;
  const rows = t.rows.map((row, i) =>
    i === t.rowIndex
      ? {
          ...row,
          cells: row.cells.map((c: any, j: number) => (j === colIndex ? withCellText(c, value) : c)),
        }
      : row,
  );
  return writeRows(editor, t.block, rows);
}

/** データ行を削除する（ヘッダは残る。最後のデータ行を消すとテーブルは generator に無視される） */
export function removeTableRow(editor: any, tableBlockId: string, rowName: string): boolean {
  const t = findTableRow(editor, tableBlockId, rowName);
  if (!t) return false;
  const rows = t.rows.filter((_, i) => i !== t.rowIndex);
  return writeRows(editor, t.block, rows);
}
