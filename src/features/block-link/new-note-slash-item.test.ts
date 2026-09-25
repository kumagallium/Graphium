// スラッシュメニューの「新しいノート」（buildNewNoteSlashItem）のテスト
//
// メインエディタと SidePeek が同じ組み立てを使う。ここでは組み立てが決める部分
// （名前を尋ねる → 作る → @リンクを入れる → リンクと派生関係を記録する）を確かめる。
// 記録先はエディタごとに渡すので、テストでは偽物で受ける。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncLocale } from "../../i18n";
import { buildNewNoteSlashItem, type NewNoteSlashItemDeps } from "./new-note-slash-item";

/** カーソルのブロック ID を返し、@リンクの挿入を受けるだけのエディタ */
function fakeEditor(cursorBlockId: string | null) {
  return {
    getTextCursorPosition: vi.fn(() => ({ block: cursorBlockId ? { id: cursorBlockId } : undefined })),
    insertInlineContent: vi.fn(),
  };
}

function setup(overrides: Partial<NewNoteSlashItemDeps> = {}) {
  const editor = fakeEditor("block-1");
  const deps = {
    promptNoteName: vi.fn(async (): Promise<string | null> => "Sourdough trial 5"),
    createNote: vi.fn(async (): Promise<string | null> => "note-new"),
    getEditor: vi.fn((): any => editor),
    addLink: vi.fn(),
    addNoteLink: vi.fn(),
    ...overrides,
  };
  return { editor, deps, item: buildNewNoteSlashItem(deps) };
}

/** 名前入力・作成（Promise）と挿入の setTimeout を流しきる */
const flush = () => vi.runAllTimersAsync();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  syncLocale("en");
});

describe("buildNewNoteSlashItem", () => {
  it("名前を入れると、ノートを作り、@リンクを入れて、リンクと派生関係を記録する", async () => {
    const { editor, deps, item } = setup();
    item.onItemClick(editor);
    await flush();

    expect(deps.promptNoteName).toHaveBeenCalledWith("");
    expect(deps.createNote).toHaveBeenCalledWith("Sourdough trial 5");
    expect(editor.insertInlineContent).toHaveBeenCalledWith([
      { type: "text", text: "@Sourdough trial 5", styles: { textColor: "blue" } },
      { type: "text", text: " ", styles: {} },
    ]);
    expect(deps.addLink).toHaveBeenCalledWith({
      sourceBlockId: "block-1",
      targetBlockId: "",
      targetNoteId: "note-new",
      type: "reference",
      createdBy: "human",
    });
    expect(deps.addNoteLink).toHaveBeenCalledWith({
      targetNoteId: "note-new",
      sourceBlockId: "block-1",
      type: "derived_from",
    });
  });

  it("記録は @リンクを入れた後に行う", async () => {
    const addLink = vi.fn();
    const addNoteLink = vi.fn();
    const { editor, item } = setup({ addLink, addNoteLink });
    item.onItemClick(editor);
    await flush();

    const inserted = editor.insertInlineContent.mock.invocationCallOrder[0];
    expect(addLink.mock.invocationCallOrder[0]).toBeGreaterThan(inserted);
    expect(addNoteLink.mock.invocationCallOrder[0]).toBeGreaterThan(inserted);
  });

  it("名前の前後の空白は落として作る", async () => {
    const { editor, deps, item } = setup({ promptNoteName: vi.fn(async () => "  Levain  ") });
    item.onItemClick(editor);
    await flush();

    expect(deps.createNote).toHaveBeenCalledWith("Levain");
    expect(editor.insertInlineContent.mock.calls[0][0][0].text).toBe("@Levain");
  });

  it.each([
    ["キャンセル", null],
    ["空白だけ", "   "],
  ])("%sなら何も作らない", async (_label, answer) => {
    const { editor, deps, item } = setup({ promptNoteName: vi.fn(async () => answer) });
    item.onItemClick(editor);
    await flush();

    expect(deps.createNote).not.toHaveBeenCalled();
    expect(editor.insertInlineContent).not.toHaveBeenCalled();
    expect(deps.addLink).not.toHaveBeenCalled();
    expect(deps.addNoteLink).not.toHaveBeenCalled();
  });

  it("作れなかったら @リンクを入れず、記録もしない", async () => {
    const { editor, deps, item } = setup({ createNote: vi.fn(async () => null) });
    item.onItemClick(editor);
    await flush();

    expect(editor.insertInlineContent).not.toHaveBeenCalled();
    expect(deps.addLink).not.toHaveBeenCalled();
    expect(deps.addNoteLink).not.toHaveBeenCalled();
  });

  it("@リンクは入れる時点のエディタに入れる（名前を入れている間に作り直されても届く）", async () => {
    const recreated = fakeEditor("block-1");
    const { editor: clicked, deps, item } = setup({ getEditor: vi.fn(() => recreated) });
    item.onItemClick(clicked);
    await flush();

    expect(clicked.insertInlineContent).not.toHaveBeenCalled();
    expect(recreated.insertInlineContent).toHaveBeenCalledTimes(1);
    expect(deps.addLink).toHaveBeenCalledTimes(1);
  });

  it("リンク元は押した時点のカーソルのブロック", async () => {
    const { editor, deps, item } = setup();
    item.onItemClick(editor);
    // 名前を入れている間にカーソルが動いても、押したブロックから張る
    editor.getTextCursorPosition.mockReturnValue({ block: { id: "block-2" } });
    await flush();

    expect(deps.addLink).toHaveBeenCalledWith(expect.objectContaining({ sourceBlockId: "block-1" }));
    expect(deps.addNoteLink).toHaveBeenCalledWith(expect.objectContaining({ sourceBlockId: "block-1" }));
  });

  it("エディタが無くなっていたら記録もしない（本文に無いリンクを残さない）", async () => {
    const { editor, deps, item } = setup({ getEditor: vi.fn(() => null) });
    item.onItemClick(editor);
    await flush();

    expect(deps.addLink).not.toHaveBeenCalled();
    expect(deps.addNoteLink).not.toHaveBeenCalled();
  });

  it("カーソルのブロックが取れないときは @リンクだけ入れる", async () => {
    const editor = fakeEditor(null);
    const { deps, item } = setup({ getEditor: vi.fn(() => editor) });
    item.onItemClick(editor);
    await flush();

    expect(editor.insertInlineContent).toHaveBeenCalledTimes(1);
    expect(deps.addLink).not.toHaveBeenCalled();
    expect(deps.addNoteLink).not.toHaveBeenCalled();
  });

  it("ラベルは言語の切り替えに追従する（useMemo で保持しても古いラベルが残らない）", () => {
    const { item } = setup();
    syncLocale("en");
    expect(item.title).toBe("New note");
    syncLocale("ja");
    expect(item.title).toBe("新しいノート");
    expect(item.group).toBe("ノート");
  });
});
