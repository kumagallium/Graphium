// テーブルセルの読み書き（読み取りスナップショット・セル差し替え・列位置の解決）
import { describe, expect, it } from "vitest";
import { findColumnIndexByName, readCellText, readTableData, withCellText } from "./table-cells";

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

describe("withCellText", () => {
  it("tableCell は props（色・配置・結合）を残して中身だけ差し替える", () => {
    const original = {
      type: "tableCell",
      content: cell("Sample-1"),
      props: { colspan: 1, rowspan: 1, backgroundColor: "blue", textColor: "default", textAlignment: "center" },
    };
    const next = withCellText(original, "@TargetNote", { textColor: "blue" });
    expect(next).toEqual({
      type: "tableCell",
      content: [{ type: "text", text: "@TargetNote", styles: { textColor: "blue" } }],
      props: original.props,
    });
    // 元のセルは変えない
    expect(readCellText(original)).toBe("Sample-1");
  });

  it("旧 inline 配列形式のセルは配列のまま返す", () => {
    expect(withCellText(cell("old"), "@N")).toEqual([
      { type: "text", text: "@N", styles: {} },
    ]);
  });

  it("先頭列の行の同一性（tableRowIdentity）は新しい文字へ引き継ぐ", () => {
    // 行アイコンの「ノートを作成」や先頭列での @ が名前セルを書き換えても、
    // 行が別の Entity として採番し直されないように
    const first = {
      type: "tableCell",
      content: [{ type: "text", text: "Sample 2", styles: { tableRowIdentity: "row_abc" } }],
      props: { colspan: 1, rowspan: 1 },
    };
    expect(withCellText(first, "@Sample 2", { textColor: "blue" }).content).toEqual([
      { type: "text", text: "@Sample 2", styles: { textColor: "blue", tableRowIdentity: "row_abc" } },
    ]);
    // 行の同一性が無いセル・空文字への書き換えには付けない
    expect(withCellText(cell("x"), "@N").every((c: any) => !c.styles.tableRowIdentity)).toBe(true);
    expect(withCellText(first, "").content[0].styles).toEqual({});
  });
});

describe("findColumnIndexByName", () => {
  const block = tableBlock([
    ["Name", "Condition 1", "Input from"],
    ["A-1", "300 rpm", ""],
  ]);

  it("ヘッダ行のテキストで列の位置を引く", () => {
    expect(findColumnIndexByName(block, "Name")).toBe(0);
    expect(findColumnIndexByName(block, "Input from")).toBe(2);
  });

  it("列名が無い・見つからないときは先頭列に倒す", () => {
    expect(findColumnIndexByName(block, undefined)).toBe(0);
    expect(findColumnIndexByName(block, "存在しない列")).toBe(0);
  });
});
