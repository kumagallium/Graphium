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

// ── 比較器を Intl.Collator に替えても、並びが 1 つも変わらないこと ──
import { isNumericColumn, sortRowOrder, type SortState } from "./sort-table";
import { parseNumeric } from "../../blocks/chart/chart-data";

// 変更前の実装（localeCompare を直接呼ぶ）。並びの基準として固定しておく
function referenceOrder(rows: string[][], sort: NonNullable<SortState>): number[] {
  const { col, dir } = sort;
  const sign = dir === "asc" ? 1 : -1;
  const numeric = isNumericColumn(rows, col);
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const va = (a.row[col] ?? "").trim();
      const vb = (b.row[col] ?? "").trim();
      if (va === "" && vb === "") return a.i - b.i;
      if (va === "") return 1;
      if (vb === "") return -1;
      if (numeric) {
        const na = parseNumeric(va);
        const nb = parseNumeric(vb);
        if (na === null && nb === null) return a.i - b.i;
        if (na === null) return 1;
        if (nb === null) return -1;
        return na === nb ? a.i - b.i : (na - nb) * sign;
      }
      const c = va.localeCompare(vb, undefined, { numeric: true });
      return c === 0 ? a.i - b.i : c * sign;
    })
    .map((x) => x.i);
}

describe("sortRowOrder（比較器の差し替えで並びが変わらない）", () => {
  const columns: Record<string, string[]> = {
    数値: ["10", "2", "1,200", "0.5", "-3", "8e-4", "", "abc", "36.5℃"],
    文字列: ["banana", "Apple", "apple", "Cherry", "", "  cherry ", "APPLE", "あ", "ア"],
    混在: ["3", "x", "10", "", "2", "y", "１０", "b2", "b10"],
    日本語: ["みかん", "りんご", "ミカン", "バナナ", "ばなな", "柿", "梨", "なし", "リンゴ"],
    全角数字: ["１", "２", "１０", "２０", "1", "10", "ａ１", "ａ１０", "ａ２"],
    自然順: ["item2", "item10", "item1", "Item3", "item02", "item 5", "item-4", "item20", "item3"],
  };
  for (const [name, values] of Object.entries(columns)) {
    for (const dir of ["asc", "desc"] as const) {
      it(`${name}（${dir}）`, () => {
        const rows = values.map((v) => [v]);
        expect(sortRowOrder(rows, { col: 0, dir })).toEqual(referenceOrder(rows, { col: 0, dir }));
      });
    }
  }

  it("item2 と item10 は数の大きさで並ぶ", () => {
    const rows = [["item10"], ["item2"], ["item1"]];
    expect(sortRowOrder(rows, { col: 0, dir: "asc" }).map((i) => rows[i][0])).toEqual(["item1", "item2", "item10"]);
  });

  it("乱数で作った大量の文字列でも、基準の実装と完全に同じ並び", () => {
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pool = ["item", "Item", "apple", "りんご", "ミカン", "１０", "x", "", "-", "2", "10"];
    const rows = Array.from({ length: 3000 }, () => [
      pool[Math.floor(rnd() * pool.length)] + (rnd() < 0.7 ? String(Math.floor(rnd() * 120)) : ""),
    ]);
    for (const dir of ["asc", "desc"] as const) {
      expect(sortRowOrder(rows, { col: 0, dir })).toEqual(referenceOrder(rows, { col: 0, dir }));
    }
  });
});
