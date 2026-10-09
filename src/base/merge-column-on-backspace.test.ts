// @vitest-environment jsdom
//
// 段組みの 2 段目以降の先頭で Backspace を押すと、段が前の段へ寄ること。
// BlockNote 0.47 の同じ処理は、段組みが解除される・後ろにブロックがある場合に
// RangeError で落ちて何もしなかった（ノートの一行目の段組みで「段が消えない」）。

import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { columnBlock, columnListBlock } from "../blocks/multi-column";
import { keepTextDeleteBesideColumnListExtension } from "./keep-text-delete-beside-column-list";
import { deleteEmptyFirstLineOnBackspaceExtension } from "./delete-empty-first-line-on-backspace";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";
import { mergeColumnOnBackspaceExtension } from "./merge-column-on-backspace";

const p = (id: string, text: string) => ({ id, type: "paragraph", content: text });
const h = (id: string, text: string) => ({ id, type: "heading", content: text });
const columns = (...cols: any[][]) => ({
  id: "cl",
  type: "columnList",
  children: cols.map((children, i) => ({ id: `cl-${i}`, type: "column", children })),
});

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      columnList: columnListBlock.spec,
      column: columnBlock.spec,
    } as any,
  });
  // 本番（editor.tsx）と同じ Backspace 系の拡張を載せる
  const editor = BlockNoteEditor.create({
    schema,
    initialContent,
    extensions: [
      preserveChildIndentOnBackspaceExtension,
      deleteEmptyFirstLineOnBackspaceExtension,
      keepTextDeleteBesideColumnListExtension,
      mergeColumnOnBackspaceExtension,
    ],
  } as any) as any;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

function backspace(editor: any) {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, cancelable: true });
  // prosemirror-view の keydown と同じ順: handleDOMEvents.keydown → handleKeyDown（keymap）
  const consumed = view.someProp("handleDOMEvents", (f: any) => f.keydown?.(view, event));
  if (!consumed) view.someProp("handleKeyDown", (f: any) => f(view, event));
}

/** 本文の形。段組みは列ごとの「id:文字」の配列。BlockNote が自動で足す末尾の空段落（UUID）は除く */
function shape(editor: any) {
  const text = (b: any) => `${b.id}:${b.content?.[0]?.text ?? ""}`;
  return editor.document
    .filter((b: any) => b.id.length < 8)
    .map((b: any) =>
      b.type === "columnList" ? b.children.map((c: any) => c.children.map(text)) : text(b),
    );
}
const caretBlock = (editor: any) => editor.getTextCursorPosition().block.id;
const caretOffset = (editor: any) => {
  const sel = editor._tiptapEditor.state.selection;
  return sel.$from.parentOffset;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("mergeColumnOnBackspace", () => {
  it("一行目の 2 段組みで、空の 2 段目の先頭 → 段組みが解け、キャレットは 1 段目の末尾", () => {
    const editor = makeEditor([columns([p("a", "abc")], [p("b", "")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(shape(editor)).toEqual(["a:abc", "z:"]);
    expect(caretBlock(editor)).toBe("a");
    expect(caretOffset(editor)).toBe(3);
  });

  it("両方の段が空でも段組みが解ける（後ろにブロックが無い場合も）", () => {
    for (const rest of [[], [p("z", "")]]) {
      const editor = makeEditor([columns([p("a", "")], [p("b", "")]), ...rest]);
      editor.setTextCursorPosition("b", "start");
      backspace(editor);
      expect(editor.document.some((b: any) => b.type === "columnList")).toBe(false);
      expect(editor.document[0].id).toBe("a");
      expect(caretBlock(editor)).toBe("a");
    }
  });

  it("文字のある 2 段目の先頭 → 1 段目の下へ移って段組みが解け、キャレットは移した行の先頭", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(shape(editor)).toEqual(["a:x", "b:y", "z:"]);
    expect(caretBlock(editor)).toBe("b");
    expect(caretOffset(editor)).toBe(0);
    // もう一度で前の行と結合（通常の段落と同じ）
    backspace(editor);
    expect(shape(editor)).toEqual(["a:xy", "z:"]);
  });

  it("段組みが本文の途中にあっても同じ", () => {
    const editor = makeEditor([p("t", "top"), columns([p("a", "x")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(shape(editor)).toEqual(["t:top", "a:x", "b:y", "z:"]);
  });

  it("3 段組みの中の段は消えるが、残りが 2 段以上なら段組みのまま", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "")], [p("d", "d")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(shape(editor)).toEqual([[["a:x"], ["d:d"]], "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("2 段目に行が残るなら段組みのまま、先頭の空行だけ消える", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", ""), p("c", "c")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(shape(editor)).toEqual([[["a:x"], ["c:c"]], "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("2 段目の見出しは、まず段落に戻す（BlockNote 標準）", () => {
    const editor = makeEditor([columns([p("a", "x")], [h("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    backspace(editor);
    expect(editor.getBlock("b").type).toBe("paragraph");
    expect(shape(editor)).toEqual([[["a:x"], ["b:y"]], "z:"]);
  });

  it("キャレットが先頭でなければ触らない", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "yz")]), p("z", "")]);
    editor.setTextCursorPosition("b", "end");
    const before = JSON.stringify(editor.document);
    const view = editor._tiptapEditor.view;
    const event = new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, cancelable: true });
    const handled = view.someProp("handleKeyDown", (f: any) => f(view, event));
    // 標準の 1 文字削除はブラウザ任せなので、PM 側では何も変わらない
    expect(handled).toBeFalsy();
    expect(JSON.stringify(editor.document)).toBe(before);
  });
});
