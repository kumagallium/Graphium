// @vitest-environment jsdom
//
// 引用・Callout の中の Enter: 改行になり、最後の空行・空のブロックでだけ外へ出る。
// キー処理は prosemirror-view と同じく handleKeyDown を順に呼んで確かめる。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { calloutBlock } from "../blocks/callout";
import { enterActionFor, enterInTextContainerExtension } from "./enter-in-text-container";

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, callout: (calloutBlock.spec as any)() } as any,
  });
  const editor = BlockNoteEditor.create({
    schema,
    initialContent,
    extensions: [enterInTextContainerExtension()],
  } as any) as any;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

function pressEnter(editor: any, init: KeyboardEventInit = {}) {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent("keydown", { key: "Enter", ...init });
  return view.someProp("handleKeyDown", (f: any) => f(view, event)) ?? false;
}

/** 空段落は BlockNote が末尾に常に補うので除く */
const blocks = (editor: any) =>
  editor.document
    .map((b: any) => [b.type, (b.content ?? []).map((c: any) => c.text).join("")])
    .filter(([type, text]: string[], i: number, all: any[]) => !(type === "paragraph" && text === "" && i === all.length - 1));

describe.each(["quote", "callout"])("%s の中の Enter", (type) => {
  it("文字の末尾で Enter → 改行（ブロックから出ない）", () => {
    const editor = makeEditor([{ id: "x", type, content: "one" }]);
    editor.setTextCursorPosition("x", "end");
    expect(enterActionFor(editor._tiptapEditor.state)).toBe("break");
    expect(pressEnter(editor)).toBe(true);
    editor._tiptapEditor.view.dispatch(editor._tiptapEditor.state.tr.insertText("two"));
    expect(blocks(editor)).toEqual([[type, "one\ntwo"]]);
  });

  it("最後の空行で Enter → 空行を消して下に段落を作る", () => {
    const editor = makeEditor([{ id: "x", type, content: "one\n" }, { id: "n", type: "paragraph", content: "next" }]);
    editor.setTextCursorPosition("x", "end");
    expect(enterActionFor(editor._tiptapEditor.state)).toBe("exit");
    expect(pressEnter(editor)).toBe(true);
    expect(blocks(editor)).toEqual([[type, "one"], ["paragraph", ""], ["paragraph", "next"]]);
    // キャレットは新しい段落
    expect(editor.getTextCursorPosition().block.id).toBe(editor.document[1].id);
  });

  it("途中の空行では外に出ず改行する", () => {
    const editor = makeEditor([{ id: "x", type, content: "one\n\ntwo" }]);
    const view = editor._tiptapEditor.view;
    editor.setTextCursorPosition("x", "start");
    // "one" + hardBreak の直後（空行）へキャレットを置く
    const start = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection((view.state.selection.constructor as any).near(view.state.doc.resolve(start + 4))));
    expect(enterActionFor(view.state)).toBe("break");
  });

  it("空のブロックで Enter → ふつうの段落に戻す", () => {
    const editor = makeEditor([{ id: "x", type, content: "" }]);
    editor.setTextCursorPosition("x", "start");
    expect(pressEnter(editor)).toBe(true);
    expect(editor.getBlock("x").type).toBe("paragraph");
  });

  it("Shift+Enter や IME 変換中の Enter には触らない", () => {
    const editor = makeEditor([{ id: "x", type, content: "one" }]);
    editor.setTextCursorPosition("x", "end");
    const view = editor._tiptapEditor.view;
    const ours = (init: KeyboardEventInit) =>
      (view.state.plugins.find((p: any) => p.key?.startsWith("enterInTextContainer")) as any)
        .props.handleKeyDown(view, new KeyboardEvent("keydown", { key: "Enter", ...init }));
    expect(ours({ shiftKey: true })).toBe(false);
    expect(ours({ isComposing: true })).toBe(false);
  });
});

it("段落の中の Enter は既定の処理に任せる", () => {
  const editor = makeEditor([{ id: "p", type: "paragraph", content: "one" }]);
  editor.setTextCursorPosition("p", "end");
  expect(enterActionFor(editor._tiptapEditor.state)).toBeNull();
});
