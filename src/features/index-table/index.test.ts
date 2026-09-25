// スラッシュメニューの「インデックステーブル」の挿入テスト
//
// 同じ項目をメインエディタと SidePeek の両方に出すので、挿入した表の登録（先頭列に
// note-link を付ける）は押されたエディタの受け口に届かなければならない。以前は
// グローバル 1 つで、ピークに出すとメインのノートの表の注釈に書き込む形だった。

import { afterEach, describe, expect, it, vi } from "vitest";
import { indexTableSlashItem, setRegisterIndexTableCallback } from "./index";

function makeEditor(insertedId: string) {
  // スラッシュだけが入った段落の上で押した状態
  const currentBlock = {
    id: `${insertedId}-slash`,
    type: "paragraph",
    content: [{ type: "text", text: "/", styles: {} }],
  };
  return {
    getTextCursorPosition: () => ({ block: currentBlock }),
    insertBlocks: vi.fn(() => [{ id: insertedId }]),
    removeBlocks: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("indexTableSlashItem", () => {
  it("挿入した表は押されたエディタの受け口で登録する", () => {
    vi.useFakeTimers();
    const mainEditor = makeEditor("main-table");
    const peekEditor = makeEditor("peek-table");
    const registerMain = vi.fn();
    const registerPeek = vi.fn();
    setRegisterIndexTableCallback(mainEditor, registerMain);
    setRegisterIndexTableCallback(peekEditor, registerPeek);

    indexTableSlashItem.onItemClick(peekEditor);
    vi.runAllTimers();

    expect(peekEditor.insertBlocks).toHaveBeenCalledTimes(1);
    expect(registerPeek).toHaveBeenCalledWith("peek-table");
    expect(registerMain).not.toHaveBeenCalled();
    // スラッシュだけの段落は片付ける
    expect(peekEditor.removeBlocks).toHaveBeenCalledTimes(1);
  });

  it("受け口の無いエディタでは表を入れるだけで、ほかのエディタの注釈に書き込まない", () => {
    vi.useFakeTimers();
    const mainEditor = makeEditor("main-table");
    const orphanEditor = makeEditor("orphan-table");
    const registerMain = vi.fn();
    setRegisterIndexTableCallback(mainEditor, registerMain);

    indexTableSlashItem.onItemClick(orphanEditor);
    vi.runAllTimers();

    expect(orphanEditor.insertBlocks).toHaveBeenCalledTimes(1);
    expect(registerMain).not.toHaveBeenCalled();
  });
});
