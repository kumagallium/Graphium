import { describe, it, expect } from "vitest";
import { renameTableRow, setTableCell, removeTableRow } from "./table-row-edit";

const cell = (text: string) => ({ type: "tableCell", content: [{ type: "text", text, styles: {} }] });

function makeEditor() {
  const table = {
    id: "tbl-1",
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: [cell("名前"), cell("質量"), cell("メモ")] },
        { cells: [cell("バッチA"), cell("5g"), cell("焼成用")] },
        { cells: [cell("バッチB"), cell("5g"), cell("対照")] },
      ],
    },
  };
  const updates: { id: string; content: any }[] = [];
  return {
    document: [{ id: "step-1", type: "step", content: [], children: [table] }],
    updates,
    updateBlock(id: string, patch: { content: any }) {
      updates.push({ id, content: patch.content });
    },
  };
}

const rowTexts = (content: any) =>
  content.rows.map((r: any) => r.cells.map((c: any) => c.content.map((x: any) => x.text).join("")));

describe("table-row-edit", () => {
  it("renameTableRow は該当行の 1 列目だけを書き換える", () => {
    const ed = makeEditor();
    expect(renameTableRow(ed, "tbl-1", "バッチA", "バッチA改")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチA改", "5g", "焼成用"],
      ["バッチB", "5g", "対照"],
    ]);
  });

  it("setTableCell はヘッダの列名でセルを特定して書き換える", () => {
    const ed = makeEditor();
    expect(setTableCell(ed, "tbl-1", "バッチB", "メモ", "予備")).toBe(true);
    expect(rowTexts(ed.updates[0].content)[2]).toEqual(["バッチB", "5g", "予備"]);
  });

  it("存在しない列は no-op で false", () => {
    const ed = makeEditor();
    expect(setTableCell(ed, "tbl-1", "バッチA", "純度", "99%")).toBe(false);
    expect(ed.updates).toHaveLength(0);
  });

  it("removeTableRow は該当データ行だけを消す（ヘッダは残る）", () => {
    const ed = makeEditor();
    expect(removeTableRow(ed, "tbl-1", "バッチA")).toBe(true);
    expect(rowTexts(ed.updates[0].content)).toEqual([
      ["名前", "質量", "メモ"],
      ["バッチB", "5g", "対照"],
    ]);
  });

  it("存在しない行・テーブルは no-op で false", () => {
    const ed = makeEditor();
    expect(renameTableRow(ed, "tbl-1", "バッチC", "X")).toBe(false);
    expect(removeTableRow(ed, "no-such-table", "バッチA")).toBe(false);
    expect(ed.updates).toHaveLength(0);
  });
});
