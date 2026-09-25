import { describe, expect, it, vi } from "vitest";
import {
  getEditorIndexTableCallbacks,
  openEditorSidePeek,
  registerIndexTable,
  setEditorIndexTableCallbacks,
  setEditorSidePeekCallback,
  setRegisterIndexTableCallback,
  type EditorIndexTableCallbacks,
} from "./context";

describe("editor Side Peek callback", () => {
  it("エディタごとに参照元ノートの遷移先を分離する", () => {
    const firstEditor = {};
    const secondEditor = {};
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    setEditorSidePeekCallback(firstEditor, first);
    setEditorSidePeekCallback(secondEditor, second);

    expect(openEditorSidePeek(firstEditor, "note-1")).toBe(true);
    expect(first).toHaveBeenCalledWith("note-1");
    expect(second).not.toHaveBeenCalled();

    setEditorSidePeekCallback(firstEditor, null);
    expect(openEditorSidePeek(firstEditor, "note-2")).toBe(false);
  });
});

function makeCallbacks(currentFileId: string): EditorIndexTableCallbacks {
  return {
    files: [],
    currentFileId,
    onRefreshFiles: vi.fn(),
    onOpenSidePeek: vi.fn(),
    onAddNoteLink: vi.fn(),
  };
}

describe("エディタ単位のインデックステーブルの受け口", () => {
  it("メインと SidePeek の受け口を取り違えない（ピークで作った紐付けはピークのノートへ）", () => {
    const mainEditor = {};
    const peekEditor = {};
    const main = makeCallbacks("main-note");
    const peek = makeCallbacks("peek-note");
    setEditorIndexTableCallbacks(mainEditor, main);
    setEditorIndexTableCallbacks(peekEditor, peek);

    expect(getEditorIndexTableCallbacks(peekEditor)).toBe(peek);
    expect(getEditorIndexTableCallbacks(mainEditor)).toBe(main);

    setEditorIndexTableCallbacks(peekEditor, null);
    expect(getEditorIndexTableCallbacks(peekEditor)).toBeNull();
    expect(getEditorIndexTableCallbacks(mainEditor)).toBe(main);
  });

  it("登録の無いエディタはどこにも倒さない（メインのノートに書き込まない）", () => {
    setEditorIndexTableCallbacks({}, makeCallbacks("main-note"));
    expect(getEditorIndexTableCallbacks({})).toBeNull();
    expect(getEditorIndexTableCallbacks(null)).toBeNull();
    expect(getEditorIndexTableCallbacks(undefined)).toBeNull();
  });

  it("挿入した表の登録は、押されたエディタの受け口だけに届く", () => {
    const mainEditor = {};
    const peekEditor = {};
    const main = vi.fn();
    const peek = vi.fn();
    setRegisterIndexTableCallback(mainEditor, main);
    setRegisterIndexTableCallback(peekEditor, peek);

    expect(registerIndexTable(peekEditor, "table-1")).toBe(true);
    expect(peek).toHaveBeenCalledWith("table-1");
    expect(main).not.toHaveBeenCalled();

    setRegisterIndexTableCallback(peekEditor, null);
    expect(registerIndexTable(peekEditor, "table-2")).toBe(false);
    expect(peek).toHaveBeenCalledTimes(1);
  });
});
