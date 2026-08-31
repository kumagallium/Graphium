// readTableData: 拡大表示用のスナップショット読み取り
import { describe, expect, it } from "vitest";
import { readTableData } from "./table-cells";

const cell = (text: string) => [{ type: "text", text, styles: {} }];
const tableBlock = (rows: string[][]) => ({
  id: "t1",
  type: "table",
  content: { type: "tableContent", rows: rows.map((r) => ({ cells: r.map(cell) })) },
});

describe("readTableData", () => {
  it("1 行目をヘッダ、以降をデータ行として読む", () => {
    const data = readTableData(
      tableBlock([
        ["試料", "質量"],
        ["A-1", "0.50 g"],
        ["A-2", "0.33 g"],
      ])
    );
    expect(data).toEqual({
      header: ["試料", "質量"],
      rows: [
        ["A-1", "0.50 g"],
        ["A-2", "0.33 g"],
      ],
    });
  });

  it("列数はヘッダとデータ行の最大に揃える（切り捨てで値を消さない）", () => {
    const data = readTableData(
      tableBlock([
        ["a", "b"],
        ["1", "2", "3"], // ヘッダより列が多い行
        ["4"],
      ])
    );
    expect(data?.header).toEqual(["a", "b", ""]);
    expect(data?.rows).toEqual([
      ["1", "2", "3"],
      ["4", "", ""],
    ]);
  });

  it("新形式（tableCell）のセルも読める", () => {
    const data = readTableData({
      type: "table",
      content: {
        type: "tableContent",
        rows: [
          { cells: [{ type: "tableCell", content: cell("見出し") }] },
          { cells: [{ type: "tableCell", content: cell("値") }] },
        ],
      },
    });
    expect(data).toEqual({ header: ["見出し"], rows: [["値"]] });
  });

  it("table 以外・空のテーブルは null", () => {
    expect(readTableData({ type: "paragraph" })).toBeNull();
    expect(readTableData(null)).toBeNull();
    expect(readTableData({ type: "table", content: { type: "tableContent", rows: [] } })).toBeNull();
  });
});
