import { describe, it, expect } from "vitest";
import { toTableBlock, defaultCaption } from "./to-table-block";

describe("toTableBlock", () => {
  it("見出し行 + データ行のテーブルブロックを組む", () => {
    const block = toTableBlock({
      headers: ["a", "b"],
      rows: [["1", "2"]],
      headerLines: [],
      footerLines: [],
    });
    expect(block).toEqual({
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [[{ type: "text", text: "a", styles: {} }], [{ type: "text", text: "b", styles: {} }]] },
          { cells: [[{ type: "text", text: "1", styles: {} }], [{ type: "text", text: "2", styles: {} }]] },
        ],
      },
    });
  });

  it("空セルは空の content にする（空文字の text ノードを作らない）", () => {
    const block = toTableBlock({
      headers: ["a"],
      rows: [[""]],
      headerLines: [],
      footerLines: [],
    });
    expect(block?.content.rows[1].cells[0]).toEqual([]);
  });

  it("見出しが無ければ null（挿入しない）", () => {
    expect(
      toTableBlock({ headers: [], rows: [], headerLines: [], footerLines: [] })
    ).toBeNull();
  });
});

describe("defaultCaption", () => {
  it("拡張子を落としたファイル名を使う", () => {
    expect(defaultCaption("2026-08-14_site-b.dat")).toBe("2026-08-14_site-b");
  });

  it("拡張子だけの名前でも空にしない", () => {
    expect(defaultCaption(".dat")).toBe(".dat");
  });
});
