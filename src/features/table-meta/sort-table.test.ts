// 実テーブルの並べ替え（sortTableBlock）
import { describe, expect, it, vi } from "vitest";
import { sortTableBlock } from "./sort-table";

const cell = (text: string, styles: Record<string, string> = {}) => [{ type: "text", text, styles }];
const makeEditor = (rows: any[], extraContent: Record<string, unknown> = {}) => {
  const block = {
    id: "t1",
    type: "table",
    content: { type: "tableContent", columnWidths: [120, undefined], ...extraContent, rows },
  };
  return {
    block,
    getBlock: vi.fn(() => block),
    updateBlock: vi.fn(),
  };
};

describe("sortTableBlock", () => {
  it("ヘッダ行を固定し、データ行を数値として並べ替える（単位付き可）", () => {
    const ed = makeEditor([
      { cells: [cell("試料"), cell("質量")] },
      { cells: [cell("A-1"), cell("10.5 g")] },
      { cells: [cell("A-2"), cell("2 g")] },
      { cells: [cell("A-3"), cell("0.33 g")] },
    ]);
    sortTableBlock(ed, "t1", 1, "asc");
    const rows = ed.updateBlock.mock.calls[0][1].content.rows;
    expect(rows[0].cells[0][0].text).toBe("試料"); // ヘッダはそのまま
    expect(rows.slice(1).map((r: any) => r.cells[1][0].text)).toEqual(["0.33 g", "2 g", "10.5 g"]);
  });

  it("columnWidths 等の content プロパティを保持する", () => {
    const ed = makeEditor(
      [
        { cells: [cell("a")] },
        { cells: [cell("2")] },
        { cells: [cell("1")] },
      ],
      { headerRows: 1 }
    );
    sortTableBlock(ed, "t1", 0, "asc");
    const content = ed.updateBlock.mock.calls[0][1].content;
    expect(content.columnWidths).toEqual([120, undefined]);
    expect(content.headerRows).toBe(1);
  });

  it("行はセルの装飾（スタイル）ごと移動する", () => {
    const ed = makeEditor([
      { cells: [cell("値")] },
      { cells: [cell("9", { textColor: "blue" })] },
      { cells: [cell("1")] },
    ]);
    sortTableBlock(ed, "t1", 0, "asc");
    const rows = ed.updateBlock.mock.calls[0][1].content.rows;
    expect(rows[2].cells[0][0].styles).toEqual({ textColor: "blue" }); // 9 が末尾へ、色ごと
  });

  it("既に同じ並びなら updateBlock を呼ばない（無駄な編集を作らない）", () => {
    const ed = makeEditor([
      { cells: [cell("値")] },
      { cells: [cell("1")] },
      { cells: [cell("2")] },
    ]);
    sortTableBlock(ed, "t1", 0, "asc");
    expect(ed.updateBlock).not.toHaveBeenCalled();
  });

  it("ヘッダ + 1 行以下・table 以外は何もしない", () => {
    const ed = makeEditor([{ cells: [cell("h")] }, { cells: [cell("only")] }]);
    sortTableBlock(ed, "t1", 0, "asc");
    expect(ed.updateBlock).not.toHaveBeenCalled();

    const notTable = { getBlock: () => ({ id: "p", type: "paragraph" }), updateBlock: vi.fn() };
    sortTableBlock(notTable, "p", 0, "asc");
    expect(notTable.updateBlock).not.toHaveBeenCalled();
  });

  it("降順では空セルも末尾に沈む", () => {
    const ed = makeEditor([
      { cells: [cell("値")] },
      { cells: [cell("")] },
      { cells: [cell("5")] },
      { cells: [cell("9")] },
    ]);
    sortTableBlock(ed, "t1", 0, "desc");
    const rows = ed.updateBlock.mock.calls[0][1].content.rows;
    expect(rows.slice(1).map((r: any) => r.cells[0][0].text)).toEqual(["9", "5", ""]);
  });
});
