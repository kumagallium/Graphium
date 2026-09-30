// @vitest-environment jsdom
//
// 段組みの隣の段落で、文字の Backspace / Delete が段落を列へ動かさないこと。
// 判定の純関数は EditorState で直接、実際のキー処理（handleDOMEvents → BlockNote の
// keymap）は prosemirror-view と同じ順（handleDOMEvents → handleKeyDown）で流して確かめる。

import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { columnBlock, columnListBlock } from "../blocks/multi-column";
import {
  keepTextDeleteBesideColumnListExtension,
  shouldLetBrowserDeleteText,
} from "./keep-text-delete-beside-column-list";

const p = (id: string, text: string) => ({ id, type: "paragraph", content: text });
const img = (id: string) => ({ id, type: "image", props: { url: "" } });
const columns = (id: string, left: any[], right: any[]) => ({
  id,
  type: "columnList",
  children: [
    { id: `${id}-l`, type: "column", children: left },
    { id: `${id}-r`, type: "column", children: right },
  ],
});
const table = (id: string) => ({
  id,
  type: "table",
  content: { type: "tableContent", rows: [{ cells: ["a"] }] },
});

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      columnList: columnListBlock.spec,
      column: columnBlock.spec,
    } as any,
  });
  const editor = BlockNoteEditor.create({
    schema,
    initialContent,
    extensions: [keepTextDeleteBesideColumnListExtension],
  } as any) as any;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

/** id のブロックの本文の offset 文字目にキャレットを置く */
function setCaret(editor: any, id: string, offset: number) {
  editor.setTextCursorPosition(id, "start");
  const view = editor._tiptapEditor.view;
  const from = view.state.selection.from + offset;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from)));
}

function press(editor: any, key: string, init: KeyboardEventInit = {}) {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent(
    "keydown",
    { key, keyCode: key === "Backspace" ? 8 : 46, cancelable: true, ...init },
  );
  // prosemirror-view の keydown と同じ順: handleDOMEvents.keydown → handleKeyDown（keymap）
  const consumed = view.someProp("handleDOMEvents", (h: any) => h.keydown?.(view, event));
  if (!consumed) view.someProp("handleKeyDown", (f: any) => f(view, event));
}

const state = (editor: any) => editor._tiptapEditor.state;
const topTypes = (editor: any) => editor.document.map((b: any) => b.type);
/** 段組みの最後の列に入っているブロックの id（末尾に空段落が残るので最上位は見ない） */
const lastColumnIds = (editor: any) => {
  const cl = editor.document.find((b: any) => b.type === "columnList");
  return cl.children[cl.children.length - 1].children.map((b: any) => b.id);
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("shouldLetBrowserDeleteText — Backspace", () => {
  const build = () => makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);

  it("段組みの直後の段落で、キャレットが末尾・途中なら true", () => {
    const editor = build();
    setCaret(editor, "a", 3);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(true);
    setCaret(editor, "a", 1);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(true);
  });

  it("キャレットが先頭なら false（標準の列へ移す動きに任せる）", () => {
    const editor = build();
    setCaret(editor, "a", 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });

  it("空の段落は先頭なので false", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "")]);
    setCaret(editor, "a", 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });

  it("直前が画像・表・段落なら false", () => {
    for (const prev of [img("x"), table("x"), p("x", "prev")]) {
      const editor = makeEditor([prev, p("a", "abc")]);
      setCaret(editor, "a", 3);
      expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
    }
  });

  it("選択が空でなければ false", () => {
    const editor = build();
    setCaret(editor, "a", 3);
    const view = editor._tiptapEditor.view;
    const from = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from - 2, from)));
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });

  it("画像の NodeSelection（空でない選択）は false", () => {
    const editor = makeEditor([columns("cl", [p("q", "q")], [p("r", "r")]), img("i"), p("a", "abc")]);
    const view = editor._tiptapEditor.view;
    let pos = -1;
    view.state.doc.descendants((node: any, at: number) => {
      if (node.type.name === "image") pos = at;
    });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });

  it("段組みの中の段落は、直前が columnList でないので false", () => {
    const editor = makeEditor([columns("cl", [p("a", "abc"), p("b", "def")], [p("q", "q")])]);
    setCaret(editor, "b", 2);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });

  it("Backspace / Delete 以外のキーは false", () => {
    const editor = build();
    setCaret(editor, "a", 3);
    expect(shouldLetBrowserDeleteText(state(editor), "a")).toBe(false);
  });
});

describe("shouldLetBrowserDeleteText — 表・子を持つブロック", () => {
  const twoCellTable = (id: string) => ({
    id,
    type: "table",
    content: { type: "tableContent", rows: [{ cells: ["ab", "cd"] }] },
  });

  /** 表の n 番目のセルの先頭から offset 文字目にキャレットを置く */
  function setCaretInCell(editor: any, cellIndex: number, offset: number) {
    const view = editor._tiptapEditor.view;
    const starts: number[] = [];
    view.state.doc.descendants((node: any, pos: number) => {
      if (node.type.name === "tableParagraph") starts.push(pos + 1);
    });
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, starts[cellIndex] + offset),
      ),
    );
  }

  it("直前が columnList の表: セルの途中は true、表全体の先頭は false", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), twoCellTable("t")]);
    setCaretInCell(editor, 0, 1);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(true);
    setCaretInCell(editor, 0, 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
    // 2 つ目のセルの先頭は表の先頭ではない（列へ表ごと移させない）
    setCaretInCell(editor, 1, 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(true);
  });

  it("直後が columnList の表: セルの途中は true、表全体の末尾は false（Delete）", () => {
    const editor = makeEditor([twoCellTable("t"), columns("cl", [img("i")], [p("q", "q")])]);
    setCaretInCell(editor, 1, 1);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(true);
    setCaretInCell(editor, 1, 2);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(false);
    setCaretInCell(editor, 0, 2);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(true);
  });

  it("子を持つ段落でも、段組みの直後で途中のキャレットなら true", () => {
    const editor = makeEditor([
      columns("cl", [img("i")], [p("q", "q")]),
      { ...p("a", "abc"), children: [p("c", "child")] },
    ]);
    setCaret(editor, "a", 2);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(true);
    setCaret(editor, "a", 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Backspace")).toBe(false);
  });
});

describe("shouldLetBrowserDeleteText — Delete（鏡像）", () => {
  const build = () => makeEditor([p("a", "abc"), columns("cl", [img("i")], [p("q", "q")])]);

  it("段組みの直前の段落で、キャレットが先頭・途中なら true", () => {
    const editor = build();
    setCaret(editor, "a", 0);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(true);
    setCaret(editor, "a", 2);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(true);
  });

  it("キャレットが末尾なら false（標準の動きに任せる）", () => {
    const editor = build();
    setCaret(editor, "a", 3);
    expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(false);
  });

  it("直後が画像・表・段落なら false", () => {
    for (const next of [img("x"), table("x"), p("x", "next")]) {
      const editor = makeEditor([p("a", "abc"), next]);
      setCaret(editor, "a", 1);
      expect(shouldLetBrowserDeleteText(state(editor), "Delete")).toBe(false);
    }
  });
});

describe("実際のキー処理", () => {
  it("Backspace（末尾）: BlockNote の keymap が走らず、段落は動かない", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 3);
    press(editor, "Backspace");
    expect(topTypes(editor)).toEqual(["columnList", "paragraph"]);
    expect(editor.document[1].id).toBe("a");
    expect(lastColumnIds(editor)).toEqual(["q"]);
  });

  it("Backspace（先頭）: 標準どおり段落が最後の列の末尾へ移る", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 0);
    press(editor, "Backspace");
    expect(lastColumnIds(editor)).toEqual(["q", "a"]);
  });

  it("Backspace（true を返すとき）: prosemirror-view が飛ばす lastKeyCode を手で記録する", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 3);
    const view = editor._tiptapEditor.view;
    view.input.lastKeyCode = null;
    press(editor, "Backspace");
    expect(view.input.lastKeyCode).toBe(8);
    expect(Date.now() - view.input.lastKeyCodeTime).toBeLessThan(1000);
  });

  it("Backspace（修飾キー付き）は BlockNote の keymap にも一致せず、段落は動かない", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 3);
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) {
      press(editor, "Backspace", { [mod]: true } as KeyboardEventInit);
    }
    expect(lastColumnIds(editor)).toEqual(["q"]);
  });

  it("Backspace（修飾キー付き）は拡張が取らない", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 3);
    const view = editor._tiptapEditor.view;
    for (const mod of ["altKey", "ctrlKey", "metaKey"]) {
      const event = new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, [mod]: true });
      expect(view.someProp("handleDOMEvents", (h: any) => h.keydown?.(view, event))).toBeFalsy();
    }
  });

  it("Backspace（IME 変換中）は取らず、標準の処理に流す", () => {
    const editor = makeEditor([columns("cl", [img("i")], [p("q", "q")]), p("a", "abc")]);
    setCaret(editor, "a", 3);
    press(editor, "Backspace", { isComposing: true } as KeyboardEventInit);
    expect(lastColumnIds(editor)).toEqual(["q", "a"]);
  });

  it("Delete（途中）: 段組みが崩れない", () => {
    const editor = makeEditor([p("a", "abc"), columns("cl", [img("i")], [p("q", "q")])]);
    setCaret(editor, "a", 1);
    press(editor, "Delete");
    expect(topTypes(editor)).toEqual(["paragraph", "columnList"]);
    expect(editor.document[1].children[0].children.map((b: any) => b.type)).toEqual(["image"]);
  });

  it("Delete（末尾）: 標準どおり最初の列の 1 つ目が引き出される", () => {
    const editor = makeEditor([p("a", "abc"), columns("cl", [img("i")], [p("q", "q")])]);
    setCaret(editor, "a", 3);
    press(editor, "Delete");
    expect(topTypes(editor)[0]).toBe("paragraph");
    expect(topTypes(editor)).not.toEqual(["paragraph", "columnList"]);
  });
});
