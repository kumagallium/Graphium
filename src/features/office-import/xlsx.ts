// Excel (.xlsx) を展開して、シートごとに CSV 文字列を組み立てる。
//
// .xlsx も OOXML。fflate の unzipSync で展開し、DOMParser で必要な XML だけ読む。
// シート名と並び順は xl/workbook.xml → xl/_rels/workbook.xml.rels（r:id → パス）で
// 解決する。文字列セル（t="s"）は xl/sharedStrings.xml の共有文字列プールを引く。
//
// 日付はシリアル値のまま数値として出す（Excel の書式情報 (numFmt) までは見ず、
// 「1970-01-01 からの通し番号」を人間向けの日付文字列へ変換する処理はここでは
// 行わない。取り込んだ CSV を見た人が違和感を持つかもしれないが、変換を誤ると
// 逆に数値の意味を壊すため、生の値をそのまま出すに留める）。

import { unzipSync } from "fflate";

export type XlsxSheet = {
  name: string;
  csv: string;
  rows: number;
  /** CSV にする前のセルの表（行 × 列。エスケープ前の値）。プレビューの表示に使う */
  cells: string[][];
  /** 空マスの上限を超えたので、下の行を切って返したときだけ true */
  truncated?: boolean;
  /** 空の行と列を詰めて返したとき（元の位置とは行・列がずれる）だけ true。truncated とは別の印 */
  compacted?: boolean;
};
export type XlsxReadResult = {
  sheets: XlsxSheet[];
  /** ブック全体の上限（シート数・合計マス数）で、後ろのシートを読まなかったときだけ true */
  truncated?: boolean;
};

function textOf(entries: Record<string, Uint8Array>, path: string): string | null {
  const raw = entries[path];
  if (!raw) return null;
  return new TextDecoder().decode(raw);
}

// Excel の仕様上の上限（1,048,576 行・16,384 列＝XFD）。dimension やセル参照はファイル側が
// 自由に書けるので、これを超える値は信じない。敷き詰める総マス数にも上限を置く
const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;
const MAX_GRID_CELLS = 2_000_000; // dimension を信じる面積の上限
// シートごとの空マス（padding）の予算 = max(実在セル数 × 8, 500,000)。通常の表はこの中に収まる
// （5 列の表の 6 万行目にメモが 1 つある、10 行の表の XFD 列にメモが 1 つある、といった表も位置を保つ）
const PADDING_PER_REAL_CELL = 8;
const MIN_PADDING_LIMIT = 500_000;
// ブック全体の予算。シートごとの上限だけだと、シート数を増やして空マスを積み上げられる。
// 数えるのは padding だけ（実在セルの多い正当な大きな表を切らないため）
const MAX_SHEETS = 64;
const MAX_BOOK_PADDING = 2_000_000;

/** 列文字（A, B, ..., Z, AA, ...）を 1 始まりの列番号に変換する */
function columnLettersToIndex(letters: string): number {
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index;
}

/** セル参照（例: "AB12"）を { col, row } に分解する */
function parseCellRef(ref: string): { col: number; row: number } | null {
  // 列文字は 3 桁（XFD）まで。長い列文字で桁あふれさせる細工を弾く
  const m = ref.match(/^([A-Za-z]{1,3})(\d{1,7})$/);
  if (!m) return null;
  const col = columnLettersToIndex(m[1].toUpperCase());
  const row = Number(m[2]);
  if (col < 1 || col > MAX_COL || row < 1 || row > MAX_ROW) return null;
  return { col, row };
}

/** RFC 4180 に沿って 1 フィールドをエスケープする */
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** xl/sharedStrings.xml の <si> ごとにテキストを連結した配列を作る（インデックス = si の出現順） */
function parseSharedStrings(xml: string, parser: DOMParser): string[] {
  const doc = parser.parseFromString(xml, "application/xml");
  const sis = Array.from(doc.getElementsByTagName("si"));
  return sis.map((si) => {
    // <si><t>text</t></si>（単純）と <si><r><t>run1</t></r><r><t>run2</t></r></si>（リッチテキスト）の両方を拾う
    const texts = Array.from(si.getElementsByTagName("t"));
    return texts.map((t) => t.textContent ?? "").join("");
  });
}

/** workbook.xml のシート順（name, r:id）を読む */
function parseWorkbookSheets(xml: string, parser: DOMParser): { name: string; rId: string }[] {
  const doc = parser.parseFromString(xml, "application/xml");
  const sheetEls = Array.from(doc.getElementsByTagName("sheet"));
  return sheetEls.map((el) => {
    const name = el.getAttribute("name") ?? "Sheet";
    // r:id の名前空間プレフィックスが r 以外の別名になっている文書もあるため末尾一致で拾う
    let rId = "";
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.endsWith(":id") || attr.name === "id") {
        rId = attr.value;
        break;
      }
    }
    return { name, rId };
  });
}

/** workbook.xml.rels の rId → ターゲットパス（"worksheets/sheetN.xml"） */
function parseWorkbookRels(xml: string, parser: DOMParser): Map<string, string> {
  const doc = parser.parseFromString(xml, "application/xml");
  const map = new Map<string, string>();
  for (const rel of Array.from(doc.getElementsByTagName("Relationship"))) {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

/** 1 シート分の worksheet XML を { row, col } → 値 の疎な表に読み、CSV 文字列へ変換する */
function worksheetToCsv(
  xml: string,
  parser: DOMParser,
  sharedStrings: string[],
): { csv: string; rows: number; cells: string[][]; truncated: boolean; compacted: boolean; padding: number } {
  const doc = parser.parseFromString(xml, "application/xml");

  // <dimension ref="A1:D10"/> があれば行・列の上限として使う（無ければ実データから求める）
  let maxRow = 0;
  let maxCol = 0;
  const dimension = doc.getElementsByTagName("dimension")[0];
  const dimRef = dimension?.getAttribute("ref");
  if (dimRef) {
    const parts = dimRef.split(":");
    const end = parseCellRef(parts[parts.length - 1]);
    // 上限内の dimension だけ採用する（巨大な矩形を宣言して全マスを敷き詰めさせる細工への対策）
    if (end && end.row * end.col <= MAX_GRID_CELLS) {
      maxRow = end.row;
      maxCol = end.col;
    }
  }

  // 行データ本体を { row: { col: value } } の疎な表に読む
  const cells = new Map<number, Map<number, string>>();
  const rowEls = Array.from(doc.getElementsByTagName("row"));
  // r 属性は OOXML 仕様上オプション（Excel/LibreOffice は必ず書くが、簡易な xlsx ライタは省略しうる）。
  // 省略された行は直前の行番号 + 1 をフォールバックとして採番し、黙って読み飛ばさない
  let nextRowFallback = 1;
  for (const rowEl of rowEls) {
    const rAttr = rowEl.getAttribute("r");
    const parsedRowNum = rAttr ? Number(rAttr) : NaN;
    const rowNum = Number.isFinite(parsedRowNum) && parsedRowNum > 0 ? parsedRowNum : nextRowFallback;
    nextRowFallback = rowNum + 1;
    if (rowNum > MAX_ROW) continue; // 仕様上ありえない行は読み飛ばす
    maxRow = Math.max(maxRow, rowNum);
    const rowCells = cells.get(rowNum) ?? new Map<number, string>();

    const cEls = Array.from(rowEl.children).filter((c) => c.tagName === "c");
    let fallbackCol = 0; // r 属性を持たないセルへのフォールバック（実際にはほぼ無い）
    for (const cEl of cEls) {
      const ref = cEl.getAttribute("r");
      const pos = ref ? parseCellRef(ref) : null;
      const col = pos?.col ?? ++fallbackCol;
      if (col > MAX_COL) continue;
      maxCol = Math.max(maxCol, col);

      const type = cEl.getAttribute("t") ?? "n";
      let value = "";
      if (type === "inlineStr") {
        const isEl = Array.from(cEl.getElementsByTagName("is"))[0];
        value = isEl ? Array.from(isEl.getElementsByTagName("t")).map((t) => t.textContent ?? "").join("") : "";
      } else {
        const vEl = cEl.getElementsByTagName("v")[0];
        const raw = vEl?.textContent ?? "";
        if (type === "s") {
          const idx = Number(raw);
          value = Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
        } else if (type === "b") {
          value = raw === "1" ? "TRUE" : "FALSE";
        } else {
          // "str"（数式の文字列結果）、"n"（数値。数式セルも <f> ではなく <v> の
          // 計算済み結果を使う）、無指定はどちらもそのまま文字列化する
          value = raw;
        }
      }
      rowCells.set(col, value);
    }
    cells.set(rowNum, rowCells);
  }

  // 実在セル数（同じ位置への重複は 1 つと数える）
  let realCount = 0;
  for (const rc of cells.values()) realCount += rc.size;

  // 空マスの敷き詰め（padding）の予算。実在セル数に比例させ、通常の表はこの中に収まる
  const sheetLimit = Math.max(realCount * PADDING_PER_REAL_CELL, MIN_PADDING_LIMIT);
  const limit = sheetLimit;

  let rowList: number[] | null = null; // null = 1..maxRow をそのまま出す
  let colList: number[] | null = null; // null = 1..maxCol をそのまま出す
  let compacted = false;
  let truncated = false;
  // 行は列が 0 でも 1 マスぶんの重さとして数える。セルを持たない <row r="1048576"/> だけのシートは
  // 列が 0 のまま 100 万行の空行になるので、「行数 × 列数」だけで測ると予算をすり抜ける
  if (maxRow * Math.max(1, maxCol) - realCount > limit) {
    // 位置を保つと padding が予算を超える: 実在セルの無い行と列を落として詰める（順序は保つ）
    compacted = true;
    rowList = Array.from(cells.entries())
      .filter(([, rc]) => rc.size > 0)
      .map(([r]) => r)
      .sort((x, y) => x - y);
    const used = new Set<number>();
    for (const rc of cells.values()) for (const c of rc.keys()) used.add(c);
    colList = Array.from(used).sort((x, y) => x - y);
    const width = Math.max(1, colList.length);
    if (rowList.length * width - realCount > limit) {
      // 詰めてもなお予算を超える（対角線状に散らばった巨大なシートなど）: 行を予算内で切る
      truncated = true;
      const kept: number[] = [];
      let keptReal = 0;
      for (const r of rowList) {
        const n = cells.get(r)?.size ?? 0;
        if ((kept.length + 1) * width - (keptReal + n) > limit) break;
        kept.push(r);
        keptReal += n;
      }
      rowList = kept;
    }
  }

  const grid: string[][] = [];
  const lines: string[] = [];
  const rowCount = rowList ? rowList.length : maxRow;
  const colCount = colList ? colList.length : maxCol;
  for (let i = 0; i < rowCount; i++) {
    const rowCells = cells.get(rowList ? rowList[i] : i + 1);
    const fields: string[] = [];
    for (let j = 0; j < colCount; j++) fields.push(rowCells?.get(colList ? colList[j] : j + 1) ?? "");
    grid.push(fields);
    lines.push(fields.map(escapeCsvField).join(","));
  }

  // ブック全体の予算に数える padding も、行を 1 マス以上の重さとして数える（上の判定と同じ測り方）
  const padding = Math.max(0, rowCount * Math.max(1, colCount) - realCount);
  return { csv: lines.join("\r\n"), rows: rowCount, cells: grid, truncated, compacted, padding };
}

/** .xlsx の bytes を読み、シートごとに CSV 文字列を組み立てる */
export function readXlsx(bytes: Uint8Array): XlsxReadResult {
  const entries = unzipSync(bytes);
  const parser = new DOMParser();

  const workbookXml = textOf(entries, "xl/workbook.xml");
  const relsXml = textOf(entries, "xl/_rels/workbook.xml.rels");
  if (!workbookXml || !relsXml) return { sheets: [] };

  const sharedStringsXml = textOf(entries, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml ? parseSharedStrings(sharedStringsXml, parser) : [];

  const sheetDefs = parseWorkbookSheets(workbookXml, parser);
  const rels = parseWorkbookRels(relsXml, parser);

  const sheets: XlsxSheet[] = [];
  let budget = MAX_BOOK_PADDING;
  let bookTruncated = false;
  // 同じパスを指す <sheet> は解析結果を使い回す（同じ XML を何度も解析させない）
  const parsedByPath = new Map<string, ReturnType<typeof worksheetToCsv>>();
  for (const def of sheetDefs) {
    const target = rels.get(def.rId);
    if (!target) continue;
    const path = target.startsWith("worksheets/") ? `xl/${target}` : target.startsWith("/xl/") ? target.slice(1) : target;
    // 読むシート数・合計マス数の上限を超えたら、以降は読まずに打ち切る
    if (sheets.length >= MAX_SHEETS || budget <= 0) {
      bookTruncated = true;
      break;
    }
    let parsed = parsedByPath.get(path);
    if (!parsed) {
      const sheetXml = textOf(entries, path);
      if (!sheetXml) continue;
      parsed = worksheetToCsv(sheetXml, parser, sharedStrings);
      parsedByPath.set(path, parsed);
    }
    const { csv, rows, cells, truncated, compacted, padding } = parsed;
    // 使い回した解析結果が残りの予算に収まらないときは、そこで打ち切る
    if (padding > budget) {
      bookTruncated = true;
      break;
    }
    budget -= padding;
    sheets.push({
      name: def.name,
      csv,
      rows,
      cells,
      ...(truncated ? { truncated } : {}),
      ...(compacted ? { compacted } : {}),
    });
  }

  return { sheets, ...(bookTruncated ? { truncated: true } : {}) };
}
