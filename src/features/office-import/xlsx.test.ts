// @vitest-environment jsdom
// readXlsx のテスト
//
// fflate の zipSync で最小の .xlsx（シート 2 枚＋共有文字列＋数式セル）を組み立て、
// シート名・CSV 変換（共有文字列・数式の計算結果・空行の保持・RFC 4180 エスケープ）を検証する。

import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readXlsx } from "./xlsx";

const NS_MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

function buildXlsx(): Uint8Array {
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS_MAIN} ${NS_R}>
  <sheets>
    <sheet name="People" sheetId="1" r:id="rId1"/>
    <sheet name="Notes" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${NS_RELS}>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst ${NS_MAIN} count="2" uniqueCount="2">
  <si><t>Name</t></si>
  <si><t>Alice</t></si>
</sst>`;

  // 1 行目: 共有文字列のヘッダ / 2 行目: 数値＋数式セル（計算結果は <v> を使う）/ 3 行目: 空行
  const sheet1Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS_MAIN}>
  <dimension ref="A1:B3"/>
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>10</v></c>
      <c r="B2"><f>A2*2</f><v>20</v></c>
    </row>
    <row r="3"></row>
  </sheetData>
</worksheet>`;

  // カンマ・改行・ダブルクォートを含むインライン文字列（RFC 4180 エスケープの確認用）
  const sheet2Xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS_MAIN}>
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>Hello, "world"</t></is></c>
    </row>
  </sheetData>
</worksheet>`;

  return zipSync({
    "xl/workbook.xml": strToU8(workbookXml),
    "xl/_rels/workbook.xml.rels": strToU8(relsXml),
    "xl/sharedStrings.xml": strToU8(sharedStringsXml),
    "xl/worksheets/sheet1.xml": strToU8(sheet1Xml),
    "xl/worksheets/sheet2.xml": strToU8(sheet2Xml),
  });
}

describe("readXlsx", () => {
  it("シート名の並び順を保つ", () => {
    const result = readXlsx(buildXlsx());
    expect(result.sheets.map((s) => s.name)).toEqual(["People", "Notes"]);
  });

  it("共有文字列・数式の計算結果・空行の保持を CSV に変換する", () => {
    const result = readXlsx(buildXlsx());
    const people = result.sheets.find((s) => s.name === "People");
    expect(people?.csv).toBe("Name,Alice\r\n10,20\r\n,");
    expect(people?.rows).toBe(3);
  });

  it("カンマ・引用符を含む値を RFC 4180 でエスケープする", () => {
    const result = readXlsx(buildXlsx());
    const notes = result.sheets.find((s) => s.name === "Notes");
    expect(notes?.csv).toBe('"Hello, ""world"""');
  });

  it("<row> に r 属性（行番号）が無くても行を落とさない（簡易な xlsx ライタ対策）", () => {
    // r 属性は OOXML 仕様上オプション。Excel/LibreOffice は必ず書くが、
    // 手組みの XML 生成コードなどが省略する場合がある
    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS_MAIN} ${NS_R}>
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships ${NS_RELS}>
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
    const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet ${NS_MAIN}>
  <sheetData>
    <row><c t="inlineStr"><is><t>no-r-row</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>second</t></is></c></row>
  </sheetData>
</worksheet>`;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(workbookXml),
      "xl/_rels/workbook.xml.rels": strToU8(relsXml),
      "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    });

    const result = readXlsx(bytes);
    const sheet = result.sheets.find((s) => s.name === "Sheet1");
    expect(sheet?.csv).toBe("no-r-row\r\nsecond");
    expect(sheet?.rows).toBe(2);
  });
});
