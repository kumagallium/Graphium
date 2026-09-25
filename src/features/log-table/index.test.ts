// @vitest-environment jsdom
//
// 時系列テーブルのスラッシュ項目（log-table/index.ts）のテスト
//
// 項目はメインエディタと SidePeek で共通なので、挿入した表の登録先（そのエディタの
// tableMetaStore）は押されたエディタをキーに引く。登録先がモジュール変数 1 つだと、
// ピークで挿入した表の注釈がメイン側のノートに付く。登録と同時に、そのエディタでの
// 初見（いまの行数）も記録する。

import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { applyLogTableTimestamps, logTableSlashItem, setRegisterLogTableCallback } from "./index";
import { readCellText } from "../table-meta/table-cells";

/** スラッシュを打った直後の状態（カーソルは "/" だけの段落） */
function makeEditor() {
  const editor = BlockNoteEditor.create({
    initialContent: [{ type: "paragraph", content: "/" }],
  });
  editor.setTextCursorPosition(editor.document[0], "end");
  return editor;
}

/** 登録は挿入の次のタスクで走る（onItemClick の setTimeout） */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("logTableSlashItem", () => {
  it("押されたエディタの登録先だけが呼ばれる（ピークの表がメイン側に付かない）", async () => {
    const main = makeEditor();
    const peek = makeEditor();
    const registeredInMain = vi.fn();
    const registeredInPeek = vi.fn();
    // メインを後に登録する（登録先が 1 つだと、後から登録したメイン側が呼ばれてしまう）
    setRegisterLogTableCallback(peek, registeredInPeek);
    setRegisterLogTableCallback(main, registeredInMain);

    logTableSlashItem.onItemClick(peek);
    await nextTask();

    const table = peek.document.find((block) => block.type === "table");
    expect(table).toBeDefined();
    expect(registeredInPeek).toHaveBeenCalledWith(table!.id);
    expect(registeredInMain).not.toHaveBeenCalled();
    expect(main.document.some((block) => block.type === "table")).toBe(false);
  });

  it("挿入して何も打たずに足した最初の行にも日時が入る（登録と同時に初見を記録する）", async () => {
    const editor = makeEditor();
    const logTableIds: string[] = [];
    setRegisterLogTableCallback(editor, (blockId) => logTableIds.push(blockId));

    logTableSlashItem.onItemClick(editor);
    await nextTask();

    // 表の下端の + 帯で、空の行を 1 つ足した状態にする
    const table: any = editor.document.find((block) => block.type === "table");
    const rows = table.content.rows;
    const emptyRow = { ...rows[1], cells: rows[1].cells.map((cell: any) => ({ ...cell, content: [] })) };
    editor.updateBlock(table.id, { content: { ...table.content, rows: [...rows, emptyRow] } } as any);
    applyLogTableTimestamps(editor, logTableIds, new Date(2026, 7, 12, 9, 30));

    const firstColumn = (editor.getBlock(table.id) as any).content.rows.map((row: any) =>
      readCellText(row.cells[0]),
    );
    expect(firstColumn[2]).toBe("2026-08-12 09:30");
  });

  it("登録を外したエディタでは呼ばれない", async () => {
    const editor = makeEditor();
    const registered = vi.fn();
    setRegisterLogTableCallback(editor, registered);
    setRegisterLogTableCallback(editor, null);

    logTableSlashItem.onItemClick(editor);
    await nextTask();

    expect(editor.document.some((block) => block.type === "table")).toBe(true);
    expect(registered).not.toHaveBeenCalled();
  });
});
