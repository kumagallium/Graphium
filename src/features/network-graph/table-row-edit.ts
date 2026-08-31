// 構造化テーブル（material / tool / output ラベル付き table）の行を
// グラフ側から書き換えるユーティリティ。
//
// テーブル行 Entity（@id = entity_<tableBlockId>_<rowName>）の実体は
// ノート側テーブルの 1 行（1 列目 = Entity 名、以降の列 = 属性）。
// グラフのノードで名前や属性セルを編集する = ここを通って該当セルを
// 書き換える。行の特定は「1 列目のテキストが rowName に一致する最初の
// データ行」— 同名行が複数ある場合は最初の行だけが対象（既知の制限）。

import { resolveParamLinkTarget } from "./param-link";
import { TABLE_ROW_IDENTITY_STYLE } from "../../lib/table-row-identity";

/** セルからテキストを取り出す（generator の extractCellText と同じ 2 形式対応） */
function cellText(cell: any): string {
  const content = Array.isArray(cell) ? cell : cell?.type === "tableCell" ? (cell.content ?? []) : null;
  if (!content) return "";
  return content
    .map((c: any) => (c?.type === "text" && typeof c.text === "string" ? c.text : ""))
    .join("")
    .trim();
}

/**
 * 値から inline content を組み立てる共通ルール。
 * - `@画像素材名` → インライン画像（セルの中に画像が見える）。行 ID が要る名前セルは
 *   画像 + 名前テキストにして identity を保つ（画像だけだと style の置き場所が無い）
 * - それ以外の `@参照` → 本文セルの @メンションと同じ青いテキスト
 */
function buildCellContent(text: string, styles: Record<string, string>): any[] {
  const target = resolveParamLinkTarget(text);
  if (target?.startsWith("image:")) {
    const fileId = target.slice("image:".length);
    const name = text.trim().replace(/^@/, "");
    const image = { type: "inlineImage", props: { fileId, name } };
    const identity = styles[TABLE_ROW_IDENTITY_STYLE];
    // 行 ID は text inline の style にしか置けない。名前セルは名前も残す
    return identity
      ? [image, { type: "text", text: name, styles: { [TABLE_ROW_IDENTITY_STYLE]: identity } }]
      : [image];
  }
  const next = { ...styles };
  if (target) next.textColor = "blue";
  else if (next.textColor === "blue") delete next.textColor;
  return [{ type: "text", text, styles: next }];
}

/** セルの形式（tableCell / 旧 inline 配列）を保ったままテキストを差し替える */
function withCellText(cell: any, text: string): any {
  const priorContent = Array.isArray(cell) ? cell : cell?.type === "tableCell" ? (cell.content ?? []) : [];
  const priorText = priorContent.find((inline: any) => inline?.type === "text");
  // 名前セルの tableRowIdentity を含め、既存の text style を落とさない。
  const content = buildCellContent(text, { ...(priorText?.styles ?? {}) });
  if (cell && !Array.isArray(cell) && cell.type === "tableCell") {
    return { ...cell, content };
  }
  return content;
}

/** 新しいセルの content を作る（withCellText と同じ規則） */
function newCellContent(text: string): any[] {
  return buildCellContent(text, {});
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

/** データ行を index で削除する（rowIndex はデータ行 0 始まり。同名行があっても誤爆しない） */
export function removeTableRowAt(editor: any, tableBlockId: string, rowIndex: number): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  const target = rowIndex + 1; // ヘッダ行の分
  if (target < 1 || target >= rows.length) return false;
  return writeRows(editor, block, rows.filter((_, i) => i !== target));
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

  const cell = newCellContent;
  const id = placeBlockInStep(editor, stepBlockId, {
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [cell(headerName)] }, { cells: [cell(trimmed)] }],
    },
  });
  return id ? { tableBlockId: id, created: true } : null;
}

/**
 * step の中にブロックを 1 つ置く。置き場所は step の中身の形で決まる:
 *   - 子が無い          → children ごと差し替えて置く
 *   - 空段落 1 つだけ    → その段落を置き換える（replaceBlocks で 1 トランザクション）
 *   - それ以外          → 末尾の子の後ろに足す
 *
 * 空段落のときに「後ろへ挿入 → 元の段落を削除」と 2 回に分けてはいけない。
 * 同じ tick の 2 回目は挿入前の位置で動くため、入れたばかりのブロックを
 * 巻き込んで消してしまう（実バグ: 表を作っても文書のどこにも残らなかった）。
 * @returns 置いたブロックの id（失敗時 null）
 */
function placeBlockInStep(editor: any, stepBlockId: string, block: any): string | null {
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

  const children: any[] = step.children ?? [];
  const last = children[children.length - 1];
  const onlyEmptyPara =
    children.length === 1 &&
    last?.type === "paragraph" &&
    !(last.content ?? []).some((c: any) => typeof c?.text === "string" && c.text.trim() !== "");

  try {
    if (!last) {
      editor.updateBlock(stepBlockId, { children: [block] });
      // 差し替え後の実 id は文書から読み直す
      let placed: any = null;
      const find = (blocks: any[]) => {
        for (const b of blocks ?? []) {
          if (placed) return;
          if (b?.id === stepBlockId) {
            placed = (b.children ?? [])[0];
            return;
          }
          if (Array.isArray(b?.children)) find(b.children);
        }
      };
      find(editor.document ?? []);
      return placed?.id ?? null;
    }
    if (onlyEmptyPara) {
      const result = editor.replaceBlocks([last.id], [block]);
      return result?.insertedBlocks?.[0]?.id ?? null;
    }
    return editor.insertBlocks([block], last.id, "after")?.[0]?.id ?? null;
  } catch {
    return null;
  }
}


// ── グリッド編集（右パネルのテーブル UI が使う） ──

export type TableData = {
  blockId: string;
  headers: string[];
  /** データ行（ヘッダ行を除く）。セルは文字列 */
  rows: string[][];
  /**
   * セルに埋まっているインライン画像の fileId（`"<行>:<列>"` → fileId）。
   * セル値は文字列なので、画像の有無はここで別に持つ（表示だけに使う）
   */
  cellImages?: Record<string, string>;
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
  const cellImages: Record<string, string> = {};
  rows.slice(1).forEach((row, r) => {
    (row.cells ?? []).forEach((cell: any, c: number) => {
      const fileId = cellImageFileId(cell);
      if (fileId) cellImages[`${r}:${c}`] = fileId;
    });
  });
  return {
    blockId: tableBlockId,
    headers: (rows[0].cells ?? []).map(cellText),
    rows: rows.slice(1).map((r) => (r.cells ?? []).map(cellText)),
    ...(Object.keys(cellImages).length > 0 ? { cellImages } : {}),
  };
}

/**
 * セルからインライン画像だけを外す（テキストと行 ID は残す）。
 * 画像セルは誤上書きを防ぐためテキスト編集に入らないので、外す操作をここに持つ。
 */
export function removeCellImageAt(
  editor: any,
  tableBlockId: string,
  rowIndex: number,
  colIndex: number,
): boolean {
  const block = findTableBlock(editor, tableBlockId);
  if (!block) return false;
  const rows: any[] = block.content?.rows ?? [];
  const target = rowIndex + 1; // ヘッダ行の分
  if (target < 1 || target >= rows.length) return false;
  const strip = (cell: any): any => {
    const content = Array.isArray(cell) ? cell : cell?.type === "tableCell" ? cell.content : [];
    const kept = (content ?? []).filter((inline: any) => inline?.type !== "inlineImage");
    // 画像しか無かったセルは、行 ID を引き継いだ空テキストにする（行を消さない）
    const identity = (content ?? []).find((i: any) => i?.styles?.[TABLE_ROW_IDENTITY_STYLE])
      ?.styles?.[TABLE_ROW_IDENTITY_STYLE];
    const next =
      kept.length > 0
        ? kept
        : [{ type: "text", text: "", styles: identity ? { [TABLE_ROW_IDENTITY_STYLE]: identity } : {} }];
    return cell && !Array.isArray(cell) && cell.type === "tableCell" ? { ...cell, content: next } : next;
  };
  const next = rows.map((row, i) =>
    i === target
      ? { ...row, cells: row.cells.map((c: any, j: number) => (j === colIndex ? strip(c) : c)) }
      : row,
  );
  return writeRows(editor, block, next);
}

/** セルに埋まっているインライン画像の fileId（無ければ undefined） */
function cellImageFileId(cell: any): string | undefined {
  const content = Array.isArray(cell) ? cell : cell?.type === "tableCell" ? cell.content : null;
  for (const inline of content ?? []) {
    if (
      inline?.type === "inlineImage" &&
      typeof inline.props?.fileId === "string" &&
      inline.props.fileId
    ) {
      return inline.props.fileId;
    }
  }
  return undefined;
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

/**
 * 複数の列をまとめて足す。
 *
 * addTableColumn を回し呼びしてはいけない: 1 回ごとに editor から読み直して
 * 書き戻すので、更新が反映される前の内容を土台にした書き込みが後勝ちし、
 * 3 列目以降が黙って落ちる（履歴からの一括引き継ぎで再現）。書き込みは 1 回にまとめる。
 */
export function addTableColumns(editor: any, tableBlockId: string, names: string[]): boolean {
  const block = findTableBlock(editor, tableBlockId);
  const fresh = names.map((n) => n.trim()).filter(Boolean);
  if (!block || fresh.length === 0) return false;
  const rows: any[] = block.content?.rows ?? [];
  if (rows.length === 0) return false;
  const template = rows[0].cells?.[0];
  const next = rows.map((row, i) => ({
    ...row,
    cells: [...row.cells, ...fresh.map((n) => withCellText(template, i === 0 ? n : ""))],
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

  const cell = newCellContent;
  const id = placeBlockInStep(editor, stepBlockId, {
    type: "table",
    content: {
      type: "tableContent",
      rows: [{ cells: [cell(firstKey.trim())] }, { cells: [cell("")] }],
    },
  });
  return id ? { tableBlockId: id, created: true } : null;
}
