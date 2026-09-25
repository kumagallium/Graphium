// テーブルセルの読み書き（読み取りスナップショット・セル差し替え・列位置の解決）
import { describe, expect, it } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  findColumnIndexByName,
  readCellText,
  readTableData,
  withCellText,
  writeCellText,
} from "./table-cells";

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

describe("writeCellText", () => {
  const tableCell = (text: string, props: Record<string, unknown> = {}) => ({
    type: "tableCell",
    content: cell(text),
    props: { colspan: 1, rowspan: 1, ...props },
  });
  // 先頭列を広げ、1 行目を見出しにした表（広げていない列の幅は null で持つ）
  const widenedTable = () => ({
    type: "tableContent",
    columnWidths: [260, null, null],
    headerRows: 1,
    headerCols: 1,
    rows: [
      { cells: [tableCell("Name"), tableCell("Condition"), tableCell("Memo")] },
      { cells: [tableCell("Sample A", { backgroundColor: "yellow" }), tableCell("300 K"), tableCell("")] },
      { cells: [tableCell("Sample B"), tableCell("400 K"), tableCell("")] },
    ],
  });
  // 実エディタと同じく、updateBlock は content を丸ごと置き換える
  const makeEditor = (content: any, type = "table") => {
    const block = { id: "t1", type, content };
    const updates: { id: string; content: any }[] = [];
    return {
      block,
      updates,
      getBlock: (id: string) => (id === block.id ? block : undefined),
      updateBlock(id: string, patch: { content: any }) {
        updates.push({ id, content: patch.content });
        if (id === block.id) block.content = patch.content;
      },
    };
  };

  it("書き換えても列幅と見出しの行・列の指定を残す", () => {
    const editor = makeEditor(widenedTable());
    expect(writeCellText(editor, "t1", 1, 0, "@Sample A", { textColor: "blue" })).toBe(true);
    expect(editor.block.content).toMatchObject({
      type: "tableContent",
      columnWidths: [260, null, null],
      headerRows: 1,
      headerCols: 1,
    });
  });

  it("指定したセルだけを書き換え、セルの props と他のセル・行はそのまま", () => {
    const before = widenedTable();
    const editor = makeEditor(before);
    writeCellText(editor, "t1", 1, 0, "@Sample A", { textColor: "blue" });
    const after = editor.block.content;
    expect(after.rows[1].cells[0]).toEqual({
      type: "tableCell",
      content: [{ type: "text", text: "@Sample A", styles: { textColor: "blue" } }],
      props: { colspan: 1, rowspan: 1, backgroundColor: "yellow" },
    });
    expect(after.rows[1].cells[1]).toBe(before.rows[1].cells[1]);
    expect(after.rows[0]).toBe(before.rows[0]);
    expect(after.rows[2]).toBe(before.rows[2]);
    // 元の content は変えない
    expect(readCellText(before.rows[1].cells[0])).toBe("Sample A");
  });

  it("表・行・セルが無ければ updateBlock を呼ばずに false", () => {
    const editor = makeEditor(widenedTable());
    expect(writeCellText(editor, "missing", 1, 0, "@X")).toBe(false);
    expect(writeCellText(editor, "t1", 3, 0, "@X")).toBe(false);
    expect(writeCellText(editor, "t1", 1, 3, "@X")).toBe(false);
    expect(writeCellText(editor, "t1", 1, -1, "@X")).toBe(false);
    expect(editor.updates).toEqual([]);

    const paragraph = makeEditor([{ type: "text", text: "本文", styles: {} }], "paragraph");
    expect(writeCellText(paragraph, "t1", 0, 0, "@X")).toBe(false);
    expect(paragraph.updates).toEqual([]);
  });

  it("実際の BlockNote でも、書き換えた表に列幅と見出し行が残る", () => {
    const editor = BlockNoteEditor.create({
      initialContent: [{ type: "table", content: widenedTable() }],
    } as any);
    const id = editor.document[0].id;
    expect(writeCellText(editor, id, 1, 0, "@Sample A", { textColor: "blue" })).toBe(true);
    const content = (editor.getBlock(id) as any).content;
    expect(content.columnWidths[0]).toBe(260);
    expect(content.headerRows).toBe(1);
    expect(content.headerCols).toBe(1);
    expect(readCellText(content.rows[1].cells[0])).toBe("@Sample A");
  });
});
