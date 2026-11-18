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
//   読めないセルは null として**行の位置を残す**（詰めると列どうしの計算が隣の行と
//   ずれる。集計は engine 側で空欄を飛ばす）。「数値列」という型をユーザーに宣言させない
// - **列内で単位表記が揃っていれば unit として残す**（`1 g` と `2 g` → unit "g"）。
//   評価側（engine）が mathjs の単位付き数量に変換し、`sum` が `3 g` を返せるようにする。
//   揃っていない・単位が無い列は素の数値になる
// - **記法は文字列キーに限る**。mathjs のパーサは ASCII の識別子しか受け付けず、
//   `秤量表.質量` のようなドット記法は日本語名だと構文エラーになる（実測）。
//   そのため `表["秤量表"]["質量"]` と `col("秤量表", "質量")` の 2 つを入口にする

import { matchNumericPrefix, normalizeNumericText, parseNumeric } from "../chart/chart-data";
import { readCellText } from "../../features/table-meta/table-cells";
import { peekDataTableFromBlock, registerLargeTablePreparer } from "../data-table/data";
import { yieldToEventLoop } from "../../features/data-import/large-file";
import { linkedColumnsFor, mergeLinkedColumns } from "../data-table/linked";
import { computeTableDisplayNames } from "../../features/table-meta/auto-name";
import type {
  TableColumnData,
  TableColumnsIndex,
  TableRowNamesIndex,
} from "../../features/table-meta/types";

/** 表示名 → その表の列（列名 → 列データ） */
export type TableColumns = Map<string, Map<string, TableColumnData>>;

/** 正規化済みセルテキストから、数値部分を除いた残り（単位表記）を返す */
function unitTextOf(raw: string): string {
  const s = normalizeNumericText(raw);
  const m = matchNumericPrefix(s);
  if (m === null) return "";
  return s.slice(m.length).trim();
}

/**
 * 表ブロックを「列名 → 列データ」に読む。
 * 1 行目をヘッダとして扱い、同名の列は最初の 1 つを採る。
 */
export function readTableColumns(block: any): Map<string, TableColumnData> {
  const { headers, body } = readTableText(block);
  return columnsFromText(headers, body);
}

/** 表ブロックの見出し（1 行目）と本文（2 行目以降）のセルのテキスト */
function readTableText(block: any): { headers: string[]; body: string[][] } {
  const rows: any[] = block?.content?.rows ?? [];
  if (rows.length < 2) return { headers: [], body: [] };
  const headers: string[] = (rows[0].cells ?? []).map((c: any) => readCellText(c));
  const body: string[][] = rows.slice(1).map((r: any) => (r.cells ?? []).map((c: any) => readCellText(c)));
  return { headers, body };
}

/**
 * 本文のうち、データ行として数える行。末尾の「どのセルも空の行」は記入待ちの
 * 余白なので数えない。途中の空行は位置を保つ（書き戻しは上から順にデータ行へ入れるため）。
 * 列データと行の名前は必ずこれを通し、行の数を揃える
 */
function dataRows(body: string[][]): string[][] {
  let rowCount = body.length;
  while (rowCount > 0 && body[rowCount - 1].every((c) => (c ?? "").trim() === "")) rowCount--;
  return body.slice(0, rowCount);
}

/**
 * 行の名前（1 列目のテキスト）をデータ行の順に返す。`cell("表", "行", "列")` が行を
 * 引くのに使う。見出し列（headerCols）に設定していなくても 1 列目を名前とみなす —
 * 項目名を 1 列目に書くのが表のふつうの形で、設定を探させる方が不親切なため
 */
export function rowNamesFromText(body: string[][]): string[] {
  return dataRows(body).map((row) => (row[0] ?? "").trim());
}

/**
 * 見出しと本文（セルのテキスト）を「列名 → 列データ」に読む。
 * 本文の表（readTableColumns）とデータ表（素材の parse 結果）の共通部分。
 */
export function columnsFromText(headers: string[], body: string[][]): Map<string, TableColumnData> {
  const columns = new Map<string, TableColumnData>();
  const rows = dataRows(body);
  headers.forEach((header: string, col: number) => {
    const name = header.trim();
    if (!name || columns.has(name)) return;
    const acc = newColumnAcc();
    for (const row of rows) addCell(acc, row[col] ?? "");
    columns.set(name, finishColumn(acc));
  });
  return columns;
}

/** 1 列ぶんの読み取りの途中経過（同期版と小分け版で同じ規則を使うための共通部分） */
type ColumnAcc = {
  values: (number | null)[];
  units: string[];
  unit: string | undefined;
  unitConsistent: boolean;
};

function newColumnAcc(): ColumnAcc {
  return { values: [], units: [], unit: undefined, unitConsistent: true };
}

function addCell(acc: ColumnAcc, raw: string): void {
  const value = parseNumeric(raw);
  acc.values.push(value);
  const u = value === null ? "" : unitTextOf(raw);
  acc.units.push(u);
  if (value === null) return;
  if (acc.unit === undefined) acc.unit = u;
  else if (acc.unit !== u) acc.unitConsistent = false;
}

function finishColumn(acc: ColumnAcc): TableColumnData {
  const data: TableColumnData = { values: acc.values };
  // 数値の読めた全セルで単位表記が一致したときだけ単位として扱う。
  // 混在（"1 g" と "2 kg"）は誤変換の方が怖いので列としては素の数値に落とす。
  // 1 セルだけを読む cell() にはセルごとの単位を残す（試薬表の「量」列は g と mL が混ざる）
  if (acc.unitConsistent && acc.unit) data.unit = acc.unit;
  else if (acc.units.some((u) => u !== "")) data.cellUnits = acc.units;
  return data;
}

/** 小分け版で、時間を見に行く間隔（行数） */
const WARM_CHECK_EVERY = 2000;

/**
 * 大きなデータ表の列と行の名前を、描画に順番を譲りながら先に読んでおく。
 *
 * 列の読み取りは 23 万行 × 16 列で 1.4 秒かかる。データ表が読めた直後の列の配布
 * （publishTableColumns）でこれが同期に走ると、取り込みの直後とノートを開くたびに
 * 固まる。data-table/data.ts が大きな素材を変換し終えたところでこれを呼び、結果を
 * 下のキャッシュ（columnsFromTextCached / rowNamesFromTextCached と同じもの）に
 * 入れてから「読めた」と知らせる。結果は columnsFromText / rowNamesFromText と同じ
 */
export async function warmDataTableColumns(
  headers: string[],
  body: string[][],
  opts?: { sliceMs?: number },
): Promise<void> {
  const columns = await columnsFromTextAsync(headers, body, opts);
  columnsCache.set(body, { headers, columns });
  rowNamesCache.set(body, rowNamesFromText(body));
}

/** columnsFromText と同じ結果を、描画に順番を譲りながら返す */
export async function columnsFromTextAsync(
  headers: string[],
  body: string[][],
  opts?: { sliceMs?: number },
): Promise<Map<string, TableColumnData>> {
  const sliceMs = opts?.sliceMs ?? 24;
  const columns = new Map<string, TableColumnData>();
  const rows = dataRows(body);
  let sliceStart = performance.now();
  for (let col = 0; col < headers.length; col++) {
    const name = headers[col].trim();
    if (!name || columns.has(name)) continue;
    const acc = newColumnAcc();
    for (let r = 0; r < rows.length; r++) {
      addCell(acc, rows[r][col] ?? "");
      if (r % WARM_CHECK_EVERY === WARM_CHECK_EVERY - 1 && performance.now() - sliceStart > sliceMs) {
        await yieldToEventLoop();
        sliceStart = performance.now();
      }
    }
    columns.set(name, finishColumn(acc));
  }
  return columns;
}

/**
 * columnsFromText の結果を、行配列（rows）の同一性で覚えておく版。
 *
 * データ表の rows は data-table/data.ts のキャッシュが同じ配列を返し続ける。数十万行の
 * 列の読み取りは 1.6 秒かかり、publishTableColumns は本文を編集するたび（250ms 後）に
 * 走るので、素材が変わらないかぎり読み直さない。headers の参照も一致するときだけ使う。
 * 返す Map（と中の列データ）も同じ参照になるので、setTableColumns の比較が参照一致で済む
 */
const columnsCache = new WeakMap<string[][], { headers: string[]; columns: Map<string, TableColumnData> }>();

function columnsFromTextCached(headers: string[], body: string[][]): Map<string, TableColumnData> {
  const hit = columnsCache.get(body);
  if (hit && hit.headers === headers) return hit.columns;
  const columns = columnsFromText(headers, body);
  columnsCache.set(body, { headers, columns });
  return columns;
}

/**
 * 文書中の表を表示名付きで集める。displayNames は
 * computeTableDisplayNames の結果（blockId → 表示名）。
 */
export function collectTableColumns(
  blocks: any[],
  displayNames: Map<string, string>,
  /** calc の書き戻し宣言。データ表の計算列を列として含めるために読む */
  calcWritebacks?: Record<string, unknown[]> | null,
): TableColumns {
  const tables: TableColumns = new Map();
  forEachTableText(blocks, displayNames, calcWritebacks, (name, headers, body, cacheable) => {
    tables.set(name, cacheable ? columnsFromTextCached(headers, body) : columnsFromText(headers, body));
  });
  return tables;
}

/**
 * 文書中の表の行の名前（表示名 → 1 列目のテキストの並び）。
 * 列データ（collectTableColumns）と同じ表を同じ規則で選ぶ
 */
export function collectTableRowNames(
  blocks: any[],
  displayNames: Map<string, string>,
  calcWritebacks?: Record<string, unknown[]> | null,
): TableRowNamesIndex {
  const index: TableRowNamesIndex = {};
  forEachTableText(blocks, displayNames, calcWritebacks, (name, _headers, body, cacheable) => {
    index[name] = cacheable ? rowNamesFromTextCached(body) : rowNamesFromText(body);
  });
  return index;
}

// 行の名前も、列と同じ理由で行配列の同一性で覚える（数十万行を編集のたびに
// 読み直さない。同じ配列を返すので setTableRowNames の比較も参照一致で済む）
const rowNamesCache = new WeakMap<string[][], string[]>();

function rowNamesFromTextCached(body: string[][]): string[] {
  const hit = rowNamesCache.get(body);
  if (hit) return hit;
  const names = rowNamesFromText(body);
  rowNamesCache.set(body, names);
  return names;
}

/** 文書中の表を文書順に辿り、表示名と見出し・本文のテキストを渡す */
function forEachTableText(
  blocks: any[],
  displayNames: Map<string, string>,
  calcWritebacks: Record<string, unknown[]> | null | undefined,
  /** cacheable: body が data-table のキャッシュ由来で、同一性で結果を覚えてよい */
  onTable: (name: string, headers: string[], body: string[][], cacheable: boolean) => void,
): void {
  const seen = new Set<string>();
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "table" && typeof b.id === "string") {
        const name = displayNames.get(b.id);
        // 同じ名前の表が 2 つあるときは先に出てきた方を採る（文書順で安定させる）
        if (name && !seen.has(name)) {
          seen.add(name);
          const { headers, body } = readTableText(b);
          onTable(name, headers, body, false);
        }
      } else if (b?.type === "dataTable" && typeof b.id === "string") {
        // データ表は素材が読めてから配る（読めるまでは無いものとして扱う。
        // 届いたら subscribeDataTableData 経由でホストが配り直す）
        const name = displayNames.get(b.id);
        const raw = name && !seen.has(name) ? peekDataTableFromBlock(b) : null;
        // calc が足した計算列も、他の calc やチャートからは普通の列に見える
        const merged = raw ? mergeLinkedColumns(raw, linkedColumnsFor(b.id, calcWritebacks)) : null;
        if (name && merged) {
          seen.add(name);
          // 計算列が無いときは merged.data が元の data のまま返る = rows の同一性が保たれる。
          // 計算列があるときは毎回新しい配列になるので覚えられない（今回の範囲外。毎回計算する）
          onTable(name, merged.data.headers, merged.data.rows, merged.data === raw);
        }
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
}

/** 文書中のデータ表ブロックの id（子ブロック・カラム内も含む） */
export function collectDataTableBlockIds(blocks: any[]): Set<string> {
  const ids = new Set<string>();
  const visit = (list: any[]) => {
    for (const b of list ?? []) {
      if (b?.type === "dataTable" && typeof b.id === "string") ids.add(b.id);
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(blocks ?? []);
  return ids;
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
    setTableRowNames?: (rows: TableRowNamesIndex) => void;
    setTableBlockIds?: (ids: Record<string, string>) => void;
    setDataTableBlockIds?: (ids: string[]) => void;
    calcWritebacks?: Record<string, unknown[]> | null;
  } | null | undefined,
): void {
  const doc = editor?.document;
  if (!Array.isArray(doc) || !store) return;
  const displayNames = computeTableDisplayNames(doc, store.getCaption);
  store.setTableColumns(buildTableIndex(collectTableColumns(doc, displayNames, store.calcWritebacks)));
  store.setTableRowNames?.(collectTableRowNames(doc, displayNames, store.calcWritebacks));
  // 書き戻し先の選択・実行は blockId で行うため、表示名 → blockId も一緒に配る
  if (store.setTableBlockIds) {
    const ids: Record<string, string> = {};
    for (const [blockId, name] of displayNames) {
      if (!(name in ids)) ids[name] = blockId; // 同名は文書順で先の表（読み取りと同じ規則）
    }
    store.setTableBlockIds(ids);
  }
  // データ表はセルに書けない。書き戻し先に選ばれたら「新しい列として見せる」に
  // 切り替えるため、どれがデータ表かをピッカーに教える
  store.setDataTableBlockIds?.([...collectDataTableBlockIds(doc)]);
}

// 大きな素材の変換が終わったら、知らせる前に列と行の名前を先に読んでおいてもらう
// （data-table/data.ts は calc を知らないので、こちらから登録する）
registerLargeTablePreparer((data) => warmDataTableColumns(data.headers, data.rows));
