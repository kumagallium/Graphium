import { describe, expect, it } from "vitest";
import { csvEscape, csvFileNameFor, noteTableToRows, rowsToCsv } from "./table-to-csv";

const cell = (text: string) => [{ type: "text", text, styles: {} }];

describe("csvEscape / rowsToCsv", () => {
  it("区切り・引用符・改行を含むセルだけ引用符で囲む", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line\nbreak")).toBe('"line\nbreak"');
  });

  it("見出しの列数に揃え、足りないセルは空にする", () => {
    expect(rowsToCsv(["a", "b"], [["1"], ["2", "3", "4"]])).toBe("a,b\n1,\n2,3");
  });
});

describe("noteTableToRows", () => {
  it("1 行目を見出し、残りを本文として文字列に読む", () => {
    const block = {
      type: "table",
      content: { rows: [{ cells: [cell("x"), cell("y")] }, { cells: [cell("1"), cell("2")] }] },
    };
    expect(noteTableToRows(block)).toEqual({ headers: ["x", "y"], rows: [["1", "2"]] });
  });

  it("表でなければ null", () => {
    expect(noteTableToRows({ type: "paragraph" })).toBeNull();
  });
});

describe("csvFileNameFor", () => {
  it("名前を使い、使えない文字は置き換え、空なら既定名", () => {
    expect(csvFileNameFor("xrd/測定: 結果", "table")).toBe("xrd_測定_ 結果.csv");
    expect(csvFileNameFor("   ", "table")).toBe("table.csv");
  });
});

describe("本文の表 ⇄ データ表の往復", () => {
  it("toTableBlock で本文に戻した表を noteTableToRows で読むと、同じ見出しと行に戻る", async () => {
    const { toTableBlock } = await import("../data-import/to-table-block");
    const headers = ["温度", "収率"];
    const rows = [["180", "0.82"], ["", "0.9"], ["a,b", "\"q\""]];
    const block = toTableBlock({ headers, rows, headerLines: [], footerLines: [] });
    expect(block).not.toBeNull();
    expect(noteTableToRows(block)).toEqual({ headers, rows });
  });
});
