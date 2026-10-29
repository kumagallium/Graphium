// 計算ブロックが書いたセルの割り出し（セルの電卓の印に使う）
import { describe, expect, it } from "vitest";
import { calcWrittenCells, columnIndexOf, skippedRowIndexes } from "./calc-cells";

const cell = (text: string) => [{ type: "text", text, styles: {} }];
const table = (rows: string[][]) => ({
  id: "t1",
  type: "table",
  content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
});

const rows = [
  ["材料", "比率", "重さ"],
  ["小麦粉", "100", "500"],
  ["水", "70", "350"],
  ["塩", "2", ""],
];

describe("columnIndexOf / skippedRowIndexes", () => {
  it("見出しの文字で列を探す（前後の空白は無視）", () => {
    expect(columnIndexOf(table(rows).content.rows, "重さ")).toBe(2);
    expect(columnIndexOf(table(rows).content.rows, "無い列")).toBe(-1);
  });

  it("1 列目の名前で行を探す。ヘッダは対象にしない", () => {
    const r = table(rows).content.rows;
    expect([...skippedRowIndexes(r, ["小麦粉", "材料"])]).toEqual([1]);
    expect(skippedRowIndexes(r, undefined).size).toBe(0);
  });
});

describe("calcWrittenCells", () => {
  it("書く行だけを返す（飛ばす行・空の結果は含めない）", () => {
    const cells = calcWrittenCells(table(rows), [
      { tableBlockId: "t1", column: "重さ", texts: ["500", "350", ""], skipRows: ["小麦粉"] },
    ]);
    expect(cells).toEqual([{ row: 2, col: 2 }]);
  });

  it("別の表への宣言・無い列は無視する", () => {
    expect(
      calcWrittenCells(table(rows), [
        { tableBlockId: "t2", column: "重さ", texts: ["1", "2", "3"] },
        { tableBlockId: "t1", column: "無い列", texts: ["1", "2", "3"] },
      ]),
    ).toEqual([]);
  });

  it("列まるごとの書き戻しでは値の入る全行を返す", () => {
    expect(
      calcWrittenCells(table(rows), [{ tableBlockId: "t1", column: "比率", texts: ["1", "2", "3"] }]),
    ).toEqual([
      { row: 1, col: 1 },
      { row: 2, col: 1 },
      { row: 3, col: 1 },
    ]);
  });
});
