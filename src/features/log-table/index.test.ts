// @vitest-environment jsdom
//
// 時系列テーブルのスラッシュ項目（log-table/index.ts）のテスト
//
// 項目はメインエディタと SidePeek で共通なので、挿入した表の登録先（そのエディタの
// tableMetaStore）は押されたエディタをキーに引く。登録先がモジュール変数 1 つだと、
// ピークで挿入した表の注釈がメイン側のノートに付く。

import { describe, it, expect, vi } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { logTableSlashItem, setRegisterLogTableCallback } from "./index";

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
