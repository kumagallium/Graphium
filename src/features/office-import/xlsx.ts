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

export type XlsxSheet = { name: string; csv: string; rows: number };
export type XlsxReadResult = { sheets: XlsxSheet[] };

function textOf(entries: Record<string, Uint8Array>, path: string): string | null {
  const raw = entries[path];
  if (!raw) return null;
  return new TextDecoder().decode(raw);
}

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
  const m = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return null;
  return { col: columnLettersToIndex(m[1].toUpperCase()), row: Number(m[2]) };
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
function worksheetToCsv(xml: string, parser: DOMParser, sharedStrings: string[]): { csv: string; rows: number } {
  const doc = parser.parseFromString(xml, "application/xml");

  // <dimension ref="A1:D10"/> があれば行・列の上限として使う（無ければ実データから求める）
  let maxRow = 0;
  let maxCol = 0;
  const dimension = doc.getElementsByTagName("dimension")[0];
  const dimRef = dimension?.getAttribute("ref");
  if (dimRef) {
    const parts = dimRef.split(":");
    const end = parseCellRef(parts[parts.length - 1]);
    if (end) {
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
    maxRow = Math.max(maxRow, rowNum);
    const rowCells = cells.get(rowNum) ?? new Map<number, string>();

    const cEls = Array.from(rowEl.children).filter((c) => c.tagName === "c");
    let fallbackCol = 0; // r 属性を持たないセルへのフォールバック（実際にはほぼ無い）
    for (const cEl of cEls) {
      const ref = cEl.getAttribute("r");
      const pos = ref ? parseCellRef(ref) : null;
      const col = pos?.col ?? ++fallbackCol;
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

  // maxRow/maxCol の矩形に敷き詰めて CSV へ。空セル・途中の空行はそのまま空文字の行として残す
  const lines: string[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const rowCells = cells.get(r);
    const fields: string[] = [];
    for (let c = 1; c <= maxCol; c++) {
      fields.push(escapeCsvField(rowCells?.get(c) ?? ""));
    }
    lines.push(fields.join(","));
  }

  return { csv: lines.join("\r\n"), rows: maxRow };
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
  for (const def of sheetDefs) {
    const target = rels.get(def.rId);
    if (!target) continue;
    const path = target.startsWith("worksheets/") ? `xl/${target}` : target.startsWith("/xl/") ? target.slice(1) : target;
    const sheetXml = textOf(entries, path);
    if (!sheetXml) continue;
    const { csv, rows } = worksheetToCsv(sheetXml, parser, sharedStrings);
    sheets.push({ name: def.name, csv, rows });
  }

  return { sheets };
}
