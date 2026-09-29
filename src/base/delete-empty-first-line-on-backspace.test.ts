// @vitest-environment jsdom
//
// 本文の一行目の空行を Backspace で消す拡張。標準の Backspace（BlockNote の
// KeyboardShortcuts）と、子のインデントを保つ拡張も一緒に載せて、実際のキー処理の
// 順番どおりに押したときの結果を見る。

import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { deleteEmptyFirstLineOnBackspaceExtension } from "./delete-empty-first-line-on-backspace";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";

const p = (text: string, children?: any[]) => ({
  type: "paragraph",
  content: text,
  ...(children ? { children } : {}),
});

function makeEditor(initialContent: any[]) {
  const editor = BlockNoteEditor.create({
    initialContent,
    extensions: [preserveChildIndentOnBackspaceExtension, deleteEmptyFirstLineOnBackspaceExtension],
  } as any);
  // handleKeyDown は view 経由で呼ばれるので、実 DOM にマウントする
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

/** ProseMirror がキー入力で辿る handleKeyDown の連鎖に Backspace を流す */
function pressBackspace(editor: any, init: KeyboardEventInit = {}): boolean {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, ...init });
  return Boolean(view.someProp("handleKeyDown", (f: any) => f(view, event)));
}

/** 最上位ブロックの文字だけを並べる（子は [..] で添える） */
function outline(editor: any): any[] {
  const text = (b: any) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "");
  const walk = (blocks: any[]): any[] =>
    blocks.map((b) => (b.children.length ? [text(b), walk(b.children)] : text(b)));
  return walk(editor.document);
}

function cursorBlockText(editor: any): string {
  const { block } = editor.getTextCursorPosition();
  return Array.isArray(block.content) ? block.content.map((c: any) => c.text ?? "").join("") : "";
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("本文の一行目の空行を Backspace で消す", () => {
  it("空の一行目が消え、カーソルは新しい一行目の先頭へ移る", () => {
    const editor = makeEditor([p(""), p("本文"), p("続き")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    expect(pressBackspace(editor)).toBe(true);

    expect(outline(editor).slice(0, 2)).toEqual(["本文", "続き"]);
    expect(cursorBlockText(editor)).toBe("本文");
    const { selection } = (editor as any)._tiptapEditor.state;
    expect(selection.empty).toBe(true);
    expect(selection.$from.parentOffset).toBe(0);
  });

  it("空行が続くときは連打で 1 行ずつ消え、文字のある行で止まる", () => {
    const editor = makeEditor([p(""), p(""), p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor);
    pressBackspace(editor);
    pressBackspace(editor);

    expect(outline(editor)[0]).toBe("本文");
    expect(cursorBlockText(editor)).toBe("本文");
  });

  it("文字のある一行目の先頭では何も消さない", () => {
    const editor = makeEditor([p("タイトルっぽい行"), p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor);

    expect(outline(editor).slice(0, 2)).toEqual(["タイトルっぽい行", "本文"]);
  });

  it("ノートが空の一行だけなら消さない", () => {
    const editor = makeEditor([p("")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    expect(pressBackspace(editor)).toBe(false);
    expect(editor.document).toHaveLength(1);
  });

  it("空の見出しは 1 回目で段落に戻り、2 回目で消える（2 行目以降と同じ段取り）", () => {
    const editor = makeEditor([{ type: "heading", props: { level: 1 }, content: "" }, p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor);
    expect(editor.document[0].type).toBe("paragraph");
    expect(outline(editor).slice(0, 2)).toEqual(["", "本文"]);

    pressBackspace(editor);
    expect(outline(editor)[0]).toBe("本文");
  });

  it("子を持つ空の一行目は、子を一段浮かせて同じ位置に残す", () => {
    const editor = makeEditor([p("", [p("子 1"), p("子 2")]), p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor);

    expect(outline(editor).slice(0, 3)).toEqual(["子 1", "子 2", "本文"]);
    expect(cursorBlockText(editor)).toBe("子 1");
  });

  it("2 行目の空行は標準どおり前の行の末尾へ移って消える", () => {
    const editor = makeEditor([p("一行目"), p(""), p("三行目")]);
    editor.setTextCursorPosition(editor.document[1].id, "start");

    pressBackspace(editor);

    expect(outline(editor).slice(0, 2)).toEqual(["一行目", "三行目"]);
    expect(cursorBlockText(editor)).toBe("一行目");
  });

  it("入れ子の先頭の空行はこの拡張では消さず、標準のインデント解除に任せる", () => {
    const editor = makeEditor([p("親", [p(""), p("子")])]);
    const emptyId = editor.document[0].children[0].id;
    editor.setTextCursorPosition(emptyId, "start");

    pressBackspace(editor);

    // 標準動作で最上位へ一段浮く。行そのものは消えない
    expect(editor.document[1].id).toBe(emptyId);
    expect(JSON.stringify(outline(editor))).toContain("子");
  });

  it("IME 変換中の Backspace は取らない", () => {
    const editor = makeEditor([p(""), p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor, { isComposing: true } as KeyboardEventInit);

    expect(outline(editor).slice(0, 2)).toEqual(["", "本文"]);
  });

  it("消した操作は 1 回の取り消しで戻る", () => {
    const editor = makeEditor([p(""), p("本文")]);
    editor.setTextCursorPosition(editor.document[0].id, "start");

    pressBackspace(editor);
    expect(outline(editor)[0]).toBe("本文");

    editor.undo();
    expect(outline(editor).slice(0, 2)).toEqual(["", "本文"]);
  });
});
