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

  it("プレビュー用のセルの表はエスケープ前の値を矩形で持つ", () => {
    const result = readXlsx(buildXlsx());
    const people = result.sheets.find((s) => s.name === "People");
    expect(people?.cells).toEqual([["Name", "Alice"], ["10", "20"], ["", ""]]);
    const notes = result.sheets.find((s) => s.name === "Notes");
    expect(notes?.cells).toEqual([['Hello, "world"']]);
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

  /** 1 枚だけのシート XML から xlsx を組む */
  function singleSheet(sheetXml: string): Uint8Array {
    return zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook ${NS_MAIN} ${NS_R}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships ${NS_RELS}><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(sheetXml),
    });
  }

  it("dimension が A1:XFD1048576 でも全マスを敷き詰めず短時間で返る", () => {
    const t = Date.now();
    const sheet = readXlsx(
      singleSheet(
        `<worksheet ${NS_MAIN}><dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      ),
    ).sheets[0];
    expect(Date.now() - t).toBeLessThan(2000);
    expect(sheet.csv).toBe("x");
  });

  it("桁数の長い列文字のセル参照で固まらない", () => {
    const t = Date.now();
    const sheet = readXlsx(
      singleSheet(
        `<worksheet ${NS_MAIN}><sheetData><row r="1"><c r="ZZZZZZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      ),
    ).sheets[0];
    expect(Date.now() - t).toBeLessThan(2000);
    expect(sheet.cells.length).toBeLessThanOrEqual(1);
  });

  it("行番号と列が巨大でも総マス数の上限で打ち切る", () => {
    const t = Date.now();
    const sheet = readXlsx(
      singleSheet(
        `<worksheet ${NS_MAIN}><sheetData><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      ),
    ).sheets[0];
    expect(Date.now() - t).toBeLessThan(5000);
    // 実在セルの行までは出すが、空の列は飛ばすので面積は実在セルに比例する範囲に収まる
    expect(sheet.cells.length * (sheet.cells[0]?.length ?? 0)).toBeLessThanOrEqual(2_000_000);
    expect(sheet.compacted).toBe(true);
  });

  it("実在するセルが多い縦長の表は面積が 200 万を超えても切らない", () => {
    // 11,000 行 x 25 列の実データ（27.5 万セル）に、200 列目の 1 セルが加わる形
    const rows: string[] = [];
    for (let r = 1; r <= 11_000; r++) {
      let cs = "";
      for (let c = 1; c <= 25; c++) cs += `<c r="${String.fromCharCode(64 + c)}${r}"><v>1</v></c>`;
      if (r === 1) cs += `<c r="GR1"><v>9</v></c>`;
      rows.push(`<row r="${r}">${cs}</row>`);
    }
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
_000); // 27 万セルを DOM で読むので重い。ほかのテストと並んで走ると 30 秒では足りないことがある

  it("詰めてもなお予算を超える対角線状のシートだけ truncated を立てる", () => {
    // 1 行に 1 セルずつ、列も 1 つずつずらす（1000 行 × 1000 列 = 100 万マス、実在 1000 → 予算 50 万を超える）
    const rows: string[] = [];
    const letters = (n: number) => {
      let s = "";
      for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
      return s;
    };
    for (let r = 1; r <= 1000; r++) rows.push(`<row r="${r}"><c r="${letters(r)}${r}"><v>1</v></c></row>`);
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
    expect(sheet.truncated).toBe(true);
    expect(sheet.compacted).toBe(true);
    expect(sheet.rows).toBeLessThan(1000);
    expect(sheet.rows).toBeGreaterThan(0);
  });

  it("同じ r:id を指す <sheet> を 40 個並べても面積が積み上がらず、シート数の上限で打ち切る", () => {
    const sheetEls = Array.from({ length: 100 }, (_, k) => `<sheet name="S${k}" sheetId="${k + 1}" r:id="rId1"/>`).join("");
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(`<workbook ${NS_MAIN} ${NS_R}><sheets>${sheetEls}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships ${NS_RELS}><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet ${NS_MAIN}><sheetData><row r="1"><c r="B2" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      ),
    });
    const t = Date.now();
    const r = readXlsx(bytes);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(r.sheets.length).toBe(64);
    expect(r.truncated).toBe(true);
    expect(r.sheets[0].csv).toBe(r.sheets[63].csv);
  });

  it("ブック全体の空マス（padding）の合計予算を超えたら後ろのシートを読まない", () => {
    // 1 枚あたり約 4.9 万マスの padding（シート単位の予算 5 万以内＝位置を保つ）を 60 枚
    const n = 60;
    const sheetEls = Array.from({ length: n }, (_, k) => `<sheet name="S${k}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("");
    const rels = Array.from(
      { length: n },
      (_, k) => `<Relationship Id="rId${k + 1}" Type="x" Target="worksheets/sheet${k + 1}.xml"/>`,
    ).join("");
    const files: Record<string, Uint8Array> = {
      "xl/workbook.xml": strToU8(`<workbook ${NS_MAIN} ${NS_R}><sheets>${sheetEls}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships ${NS_RELS}>${rels}</Relationships>`),
    };
    for (let k = 1; k <= n; k++) {
      files[`xl/worksheets/sheet${k}.xml`] = strToU8(
        `<worksheet ${NS_MAIN}><sheetData><row r="4900"><c r="J4900"><v>${k}</v></c></row></sheetData></worksheet>`,
      );
    }
    const r = readXlsx(zipSync(files));
    expect(r.truncated).toBe(true);
    expect(r.sheets.length).toBeLessThan(n);
    expect(r.sheets.length).toBeGreaterThan(30);
    const padding = r.sheets.reduce((m, sh) => m + sh.rows * (sh.cells[0]?.length ?? 0) - 1, 0);
    expect(padding).toBeLessThanOrEqual(2_000_000);
  }, 30_000);

  it("dimension で広げた空マスだけを切るときは truncated を立てず、実在セルの行は残す", () => {
    const sheet = readXlsx(
      singleSheet(
        `<worksheet ${NS_MAIN}><dimension ref="A1:Z1048576"/><sheetData><row r="3"><c r="A3" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>`,
      ),
    ).sheets[0];
    expect(sheet.rows).toBeGreaterThanOrEqual(3);
    expect(sheet.cells[2][0]).toBe("x");
    expect(sheet.truncated).toBeUndefined();
  });

  it("右端の列に 1 セルあっても、実データの行は 300 行すべて出す", () => {
    const rows: string[] = [];
    for (let r = 1; r <= 300; r++) {
      rows.push(`<row r="${r}"><c r="A${r}"><v>${r}</v></c>${r === 1 ? '<c r="XFD1"><v>9</v></c>' : ""}</row>`);
    }
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
    expect(sheet.rows).toBe(300);
    expect(sheet.cells[299][0]).toBe("300");
    // 空の列は詰めるので A 列と XFD 列の 2 列だけ残る
    expect(sheet.cells[0]).toEqual(["1", "9"]);
    expect(sheet.compacted).toBe(true);
    expect(sheet.truncated).toBeUndefined();
  }, 30_000);

  it("別々のパスの 40 シート（各 1 セルが右下の隅）でも各 1 行 1 列になり短時間で終わる", () => {
    const n = 40;
    const sheetEls = Array.from({ length: n }, (_, k) => `<sheet name="S${k}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("");
    const rels = Array.from(
      { length: n },
      (_, k) => `<Relationship Id="rId${k + 1}" Type="x" Target="worksheets/sheet${k + 1}.xml"/>`,
    ).join("");
    const files: Record<string, Uint8Array> = {
      "xl/workbook.xml": strToU8(`<workbook ${NS_MAIN} ${NS_R}><sheets>${sheetEls}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships ${NS_RELS}>${rels}</Relationships>`),
    };
    for (let k = 1; k <= n; k++) {
      const ref = k % 2 === 0 ? "XFD1048576" : "A1048576";
      files[`xl/worksheets/sheet${k}.xml`] = strToU8(
        `<worksheet ${NS_MAIN}><sheetData><row r="1048576"><c r="${ref}"><v>${k}</v></c></row></sheetData></worksheet>`,
      );
    }
    const bytes = zipSync(files);
    const t = Date.now();
    const r = readXlsx(bytes);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.sheets.length).toBe(n);
    for (const sh of r.sheets) {
      expect(sh.rows).toBe(1);
      expect(sh.cells[0].length).toBe(1);
    }
    const total = r.sheets.reduce((m, sh) => m + sh.rows * (sh.cells[0]?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(400);
    expect(r.truncated).toBeUndefined();
  }, 30_000);

  it("セルを持たない行だけのシート（<row r=\"1048576\"/>）を 40 枚並べても空行を敷き詰めない", () => {
    const n = 40;
    const sheetEls = Array.from({ length: n }, (_, k) => `<sheet name="S${k}" sheetId="${k + 1}" r:id="rId${k + 1}"/>`).join("");
    const rels = Array.from(
      { length: n },
      (_, k) => `<Relationship Id="rId${k + 1}" Type="x" Target="worksheets/sheet${k + 1}.xml"/>`,
    ).join("");
    const files: Record<string, Uint8Array> = {
      "xl/workbook.xml": strToU8(`<workbook ${NS_MAIN} ${NS_R}><sheets>${sheetEls}</sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships ${NS_RELS}>${rels}</Relationships>`),
    };
    for (let k = 1; k <= n; k++) {
      files[`xl/worksheets/sheet${k}.xml`] = strToU8(
        `<worksheet ${NS_MAIN}><sheetData><row r="1048576"/></sheetData></worksheet>`,
      );
    }
    const t = Date.now();
    const r = readXlsx(zipSync(files));
    expect(Date.now() - t).toBeLessThan(5000);
    // 列が 0 でも行は 1 マスぶんの重さとして数えるので、実在セルの無い行は詰められて 0 行になる
    for (const sh of r.sheets) expect(sh.rows).toBe(0);
  }, 30_000);

  it("空行を飛び飛びに 4,000 個並べたシート（最大行 約 100 万）も空行を敷き詰めない", () => {
    // テスト環境の DOM は兄弟要素が多いと遅いので 4,000 個にしている（最大行は同じ約 100 万）
    const rows = Array.from({ length: 4_000 }, (_, k) => `<row r="${1 + k * 250}"/>`).join("");
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook ${NS_MAIN} ${NS_R}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships ${NS_RELS}><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet ${NS_MAIN}><sheetData>${rows}</sheetData></worksheet>`),
    });
    const t = Date.now();
    const r = readXlsx(bytes);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.sheets[0].rows).toBe(0);
  }, 30_000);

  it("通常の表（20 列 × 5000 行・途中に空行と空列）は位置を保ち、印を立てない", () => {
    const col = (c: number) => (c > 26 ? "A" : "") + String.fromCharCode(65 + ((c - 1) % 26));
    const rows: string[] = [];
    for (let r = 1; r <= 5000; r++) {
      if (r % 1000 === 500) continue; // 空行
      let cs = "";
      for (let c = 1; c <= 20; c++) {
        if (c === 7) continue; // 空列
        cs += `<c r="${col(c)}${r}"><v>${r}</v></c>`;
      }
      rows.push(`<row r="${r}">${cs}</row>`);
    }
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
    expect(sheet.compacted).toBeUndefined();
    expect(sheet.truncated).toBeUndefined();
    expect(sheet.rows).toBe(5000);
    expect(sheet.cells[0].length).toBe(20);
    expect(sheet.cells[499].every((v) => v === "")).toBe(true); // 空行の位置が残る
    expect(sheet.cells[0][6]).toBe(""); // 空列の位置が残る
    expect(sheet.cells[4999][19]).toBe("5000");
  }, 30_000);

  it("5 列 × 100 行と A60000 の 1 セルは位置を保つ（詰めない）", () => {
    const rows: string[] = [];
    for (let r = 1; r <= 100; r++) {
      let cs = "";
      for (let c = 1; c <= 5; c++) cs += `<c r="${String.fromCharCode(64 + c)}${r}"><v>${r}</v></c>`;
      rows.push(`<row r="${r}">${cs}</row>`);
    }
    rows.push(`<row r="60000"><c r="A60000" t="inlineStr"><is><t>memo</t></is></c></row>`);
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
    expect(sheet.compacted).toBeUndefined();
    expect(sheet.truncated).toBeUndefined();
    expect(sheet.rows).toBe(60000);
    expect(sheet.cells[59999][0]).toBe("memo");
    expect(sheet.cells[99][4]).toBe("100");
  }, 30_000);

  it("実在セル 15,001 個（A1:C5000 と AMJ1）は詰めて 5000 行を残す", () => {
    const rows: string[] = [];
    for (let r = 1; r <= 5000; r++) {
      rows.push(`<row r="${r}"><c r="A${r}"><v>1</v></c><c r="B${r}"><v>2</v></c><c r="C${r}"><v>3</v></c>${r === 1 ? '<c r="AMJ1"><v>9</v></c>' : ""}</row>`);
    }
    const sheet = readXlsx(
      singleSheet(`<worksheet ${NS_MAIN}><sheetData>${rows.join("")}</sheetData></worksheet>`),
    ).sheets[0];
    expect(sheet.rows).toBe(5000);
    expect(sheet.compacted).toBe(true);
    expect(sheet.truncated).toBeUndefined();
    expect(sheet.cells[0]).toEqual(["1", "2", "3", "9"]);
  }, 30_000);
});
