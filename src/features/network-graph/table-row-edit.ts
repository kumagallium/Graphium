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

/**
 * step 内の該当ラベル付きテーブルに行を足す。無ければテーブルを作って 1 行目に書く。
 *
 * グラフから入出力を足したとき、単語だけの行を本文にばらまく代わりに
 * 「試料表が育つ」形にするための書き込み口（F 案）。ラベルの付与は呼び出し側
 * （labelStore を持つ側）に任せ、ここは blocks の操作だけを行う。
 *
 * @param findLabeledTableId step 配下から指定ラベルのテーブル blockId を探す関数
 * @returns { tableBlockId, created } created=true なら新規テーブル（呼び出し側でラベル付与が必要）
 */
export function appendEntityRowToTable(
  editor: any,
  stepBlockId: string,
  name: string,
  findLabeledTableId: (stepBlockId: string) => string | null,
  headerName: string,
): { tableBlockId: string; created: boolean } | null {
  const trimmed = name.trim();
  if (!editor || !trimmed) return null;

  const existingId = findLabeledTableId(stepBlockId);
  if (existingId) {
    let block: any = null;
    const visit = (blocks: any[]) => {
      for (const b of blocks ?? []) {
        if (block) return;
        if (b?.id === existingId) {
          block = b;
          return;
        }
        if (Array.isArray(b?.children)) visit(b.children);
      }
    };
    visit(editor.document ?? []);
    if (block?.type === "table") {
      const rows: any[] = block.content?.rows ?? [];
      // 同名の行が既にあれば何もしない。この関数は「本文の Entity を表へ移す」
      // 冪等な操作で、PROV 再生成のデバウンス中にボタンを連打すると、まだ
      // 薄い行が見えたまま何度も呼ばれる（実バグ: 同じ行が増え続けた）。
      // 意図的に同名の 2 行目を作りたいときはパネルの「行を追加」を使う。
      const existingRow = rows.findIndex((r, i) => i > 0 && cellText(r.cells?.[0]) === trimmed);
      if (existingRow >= 0) return { tableBlockId: existingId, created: false };
      const colCount = rows[0]?.cells?.length ?? 1;
      // 既存の空行（1 列目が空）があればそこへ書く。無ければ末尾に足す。
      const emptyIndex = rows.findIndex((r, i) => i > 0 && cellText(r.cells?.[0]) === "");
      const newCells = Array.from({ length: colCount }, (_, i) =>
        withCellText(rows[1]?.cells?.[i] ?? rows[0]?.cells?.[i], i === 0 ? trimmed : ""),
      );
      const nextRows =
        emptyIndex >= 0
          ? rows.map((r, i) => (i === emptyIndex ? { ...r, cells: newCells } : r))
          : [...rows, { ...(rows[1] ?? rows[0]), cells: newCells }];
      if (!writeRows(editor, block, nextRows)) return null;
      return { tableBlockId: existingId, created: false };
    }
  }

  // テーブルが無い: step の末尾に「名前」1 列のテーブルを作る（列は後から足せる）
  const step = (() => {
    let found: any = null;
    const visit = (blocks: any[]) => {
      for (const b of blocks ?? []) {
        if (found) return;
        if (b?.id === stepBlockId) {
          found = b;
          return;
        }
        if (Array.isArray(b?.children)) visit(b.children);
      }
    };
    visit(editor.document ?? []);
    return found;
  })();
  if (!step || step.type !== "step") return null;

  const cell = (text: string) => [{ type: "text", text, styles: {} }];
  const tableBlock = {
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [cell(headerName)] }, { cells: [cell(trimmed)] }],
    },
  };
  const children: any[] = step.children ?? [];
  let last = children[children.length - 1];
  let lastIsEmptyPara =
    children.length === 1 &&
    last?.type === "paragraph" &&
    !(last.content ?? []).some((c: any) => typeof c?.text === "string" && c.text.trim() !== "");
  if (!last) {
    // 中身が空の step: 挿入の基準になる子が無いので空段落を仕立てる
    // （放置すると無言で失敗する。作った段落は挿入後に消す）
    last = ensureLastChild(editor, stepBlockId);
    if (!last) return null;
    lastIsEmptyPara = true;
  }
  try {
    const inserted = editor.insertBlocks([tableBlock], last.id, "after");
    const id = inserted?.[0]?.id;
    if (!id) return null;
    // 空の初期段落は残さない
    if (lastIsEmptyPara) {
      try {
        editor.removeBlocks([last.id]);
      } catch {
        /* ignore */
      }
    }
    return { tableBlockId: id, created: true };
  } catch {
    return null;
  }
}

/**
 * step の最後の子ブロックを返す。子が 1 つも無ければ空段落を作って返す。
 * BlockNote の insertBlocks は参照ブロックを要求するので、中身が空の step に
 * 表を挿すときの足場に使う（呼び出し側が挿入後に消す）。
 */
function ensureLastChild(editor: any, stepBlockId: string): any | null {
  try {
    editor.updateBlock(stepBlockId, { children: [{ type: "paragraph" }] });
  } catch {
    return null;
  }
  let found: any = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (found) return;
      if (b?.id === stepBlockId) {
        found = b;
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor.document ?? []);
  const children: any[] = found?.children ?? [];
  return children[children.length - 1] ?? null;
}

// ── グリッド編集（右パネルのテーブル UI が使う） ──

export type TableData = {
  blockId: string;
  headers: string[];
  /** データ行（ヘッダ行を除く）。セルは文字列 */
  rows: string[][];
};

function findTableBlock(editor: any, tableBlockId: string): any | null {
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
  return block?.type === "table" ? block : null;
}

/** テーブルの中身をグリッドとして読む */
export function readTable(editor: any, tableBlockId: string): TableData | null {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return null;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return null;
  return {
    blockId: tableBlockId,
    headers: (rows[0].cells ?? []).map(cellText),
    rows: rows.slice(1).map((r) => (r.cells ?? []).map(cellText)),
  };
}

/** ヘッダ（列名）を書き換える */
export function renameTableColumn(
  editor: any,
  tableBlockId: string,
  colIndex: number,
  newName: string,
): boolean {
  const block = findTableBlock(editor, tableBlockId);
  const trimmed = newName.trim();
  if (!block || !trimmed) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (colIndex < 0 || colIndex >= (rows[0]?.cells?.length ?? 0)) return false;
  const next = rows.map((row, i) =>
    i === 0
      ? { ...row, cells: row.cells.map((c: any, j: number) => (j === colIndex ? withCellText(c, trimmed) : c)) }
      : row,
  );
  return writeRows(editor, block, next);
}

/** 行 index（データ行 0 始まり）と列 index でセルを書き換える */
export function setTableCellAt(
  editor: any,
  tableBlockId: string,
  rowIndex: number,
  colIndex: number,
  value: string,
): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  const target = rowIndex + 1; // ヘッダ行の分
  if (target < 1 || target >= rows.length) return false;
  const next = rows.map((row, i) =>
    i === target
      ? { ...row, cells: row.cells.map((c: any, j: number) => (j === colIndex ? withCellText(c, value) : c)) }
      : row,
  );
  return writeRows(editor, block, next);
}

/** 列を足す（ヘッダに名前、各データ行には空セル） */
export function addTableColumn(editor: any, tableBlockId: string, name: string): boolean {
  const block = findTableBlock(editor, tableBlockId);
  const trimmed = name.trim();
  if (!block || !trimmed) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return false;
  const template = rows[0].cells?.[0];
  const next = rows.map((row, i) => ({
    ...row,
    cells: [...row.cells, withCellText(template, i === 0 ? trimmed : "")],
  }));
  return writeRows(editor, block, next);
}

/** 列を消す（ヘッダとすべてのデータ行から） */
export function removeTableColumn(editor: any, tableBlockId: string, colIndex: number): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (colIndex < 0 || (rows[0]?.cells?.length ?? 0) <= 1) return false; // 最後の 1 列は残す
  const next = rows.map((row) => ({ ...row, cells: row.cells.filter((_: any, j: number) => j !== colIndex) }));
  return writeRows(editor, block, next);
}

/** 空のデータ行を足す（1 列目に name を入れる） */
export function addTableRow(editor: any, tableBlockId: string, name: string): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return false;
  const colCount = rows[0].cells.length;
  const template = rows[1]?.cells?.[0] ?? rows[0].cells[0];
  const cells = Array.from({ length: colCount }, (_, j) => withCellText(template, j === 0 ? name.trim() : ""));
  return writeRows(editor, block, [...rows, { ...(rows[1] ?? rows[0]), cells }]);
}

/**
 * step のパラメータ表（attribute ラベル付きテーブル）を用意する。
 * 無ければ「キー 1 列 + 空の値行」で作る（呼び出し側でラベル付与が必要）。
 */
export function ensureParameterTable(
  editor: any,
  stepBlockId: string,
  firstKey: string,
  findLabeledTableId: (stepBlockId: string) => string | null,
): { tableBlockId: string; created: boolean } | null {
  const existing = findLabeledTableId(stepBlockId);
  if (existing) return { tableBlockId: existing, created: false };

  let step: any = null;
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (step) return;
      if (b?.id === stepBlockId) {
        step = b;
        return;
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor?.document ?? []);
  if (!step || step.type !== "step") return null;

  const cell = (text: string) => [{ type: "text", text, styles: {} }];
  const children: any[] = step.children ?? [];
  let last = children[children.length - 1];
  let lastIsEmptyPara =
    children.length === 1 &&
    last?.type === "paragraph" &&
    !(last.content ?? []).some((c: any) => typeof c?.text === "string" && c.text.trim() !== "");
  if (!last) {
    // 中身が空の step でも無言で失敗しない（appendEntityRowToTable と同じ足場）
    last = ensureLastChild(editor, stepBlockId);
    if (!last) return null;
    lastIsEmptyPara = true;
  }
  try {
    const inserted = editor.insertBlocks(
      [
        {
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: [cell(firstKey.trim())] }, { cells: [cell("")] }],
          },
        },
      ],
      last.id,
      "after",
    );
    const id = inserted?.[0]?.id;
    if (!id) return null;
    if (lastIsEmptyPara) {
      try {
        editor.removeBlocks([last.id]);
      } catch {
        /* ignore */
      }
    }
    return { tableBlockId: id, created: true };
  } catch {
    return null;
  }
}
