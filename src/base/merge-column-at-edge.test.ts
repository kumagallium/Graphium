// @vitest-environment jsdom
//
// 段組みの段の境目で Backspace / Delete を押すと、隣の段の行が寄ること。
// BlockNote 0.47 の同じ処理は、段組みが解除される・後ろにブロックがある場合に
// RangeError で落ちて何もしない（ノートの一行目の段組みで「段が消えない」）か、
// 行を段組みの後ろの行よりさらに下へ挿入して順序を崩していた。

import { describe, it, expect, beforeEach } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { columnBlock, columnListBlock } from "../blocks/multi-column";
import { keepTextDeleteBesideColumnListExtension } from "./keep-text-delete-beside-column-list";
import { deleteEmptyFirstLineOnBackspaceExtension } from "./delete-empty-first-line-on-backspace";
import { preserveChildIndentOnBackspaceExtension } from "./preserve-child-indent-on-backspace";
import { mergeColumnAtEdgeExtension } from "./merge-column-at-edge";

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
      mergeColumnAtEdgeExtension,
    ],
  } as any) as any;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

function press(editor: any, key: "Backspace" | "Delete") {
  const view = editor._tiptapEditor.view;
  const event = new KeyboardEvent("keydown", { key, keyCode: key === "Backspace" ? 8 : 46, cancelable: true });
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

describe("mergeColumnAtEdge — Backspace", () => {
  it("一行目の 2 段組みで、空の 2 段目の先頭 → 段組みが解け、キャレットは 1 段目の末尾", () => {
    const editor = makeEditor([columns([p("a", "abc")], [p("b", "")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
    expect(shape(editor)).toEqual(["a:abc", "z:"]);
    expect(caretBlock(editor)).toBe("a");
    expect(caretOffset(editor)).toBe(3);
  });

  it("両方の段が空でも段組みが解ける（後ろにブロックが無い場合も）", () => {
    for (const rest of [[], [p("z", "")]]) {
      const editor = makeEditor([columns([p("a", "")], [p("b", "")]), ...rest]);
      editor.setTextCursorPosition("b", "start");
      press(editor, "Backspace");
      expect(editor.document.some((b: any) => b.type === "columnList")).toBe(false);
      expect(editor.document[0].id).toBe("a");
      expect(caretBlock(editor)).toBe("a");
    }
  });

  it("文字のある 2 段目の先頭 → 1 段目の下へ移って段組みが解け、キャレットは移した行の先頭", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
    expect(shape(editor)).toEqual(["a:x", "b:y", "z:"]);
    expect(caretBlock(editor)).toBe("b");
    expect(caretOffset(editor)).toBe(0);
    // もう一度で前の行と結合（通常の段落と同じ）
    press(editor, "Backspace");
    expect(shape(editor)).toEqual(["a:xy", "z:"]);
  });

  it("段組みが本文の途中にあっても同じ", () => {
    const editor = makeEditor([p("t", "top"), columns([p("a", "x")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
    expect(shape(editor)).toEqual(["t:top", "a:x", "b:y", "z:"]);
  });

  it("3 段組みの中の段は消えるが、残りが 2 段以上なら段組みのまま", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "")], [p("d", "d")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
    expect(shape(editor)).toEqual([[["a:x"], ["d:d"]], "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("2 段目に行が残るなら段組みのまま、先頭の空行だけ消える", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", ""), p("c", "c")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
    expect(shape(editor)).toEqual([[["a:x"], ["c:c"]], "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("2 段目の見出しは、まず段落に戻す（BlockNote 標準）", () => {
    const editor = makeEditor([columns([p("a", "x")], [h("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("b", "start");
    press(editor, "Backspace");
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

describe("mergeColumnAtEdge — Delete", () => {
  it("2 段組みの 1 段目の末尾 → 2 段目の行が 1 段目の下へ寄って段組みが解け、行の順序は保たれる", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual(["a:x", "b:y", "z:"]);
    // キャレットはその場（a の末尾）に残る
    expect(caretBlock(editor)).toBe("a");
    expect(caretOffset(editor)).toBe(1);
    // もう一度で次の行とつながる（通常の段落と同じ）
    press(editor, "Delete");
    expect(shape(editor)).toEqual(["a:xy", "z:"]);
  });

  it("2 段目が空なら、その行を消して段組みが解ける（段組みだけのノートでも）", () => {
    for (const rest of [[], [p("z", "")]]) {
      const editor = makeEditor([columns([p("a", "x")], [p("b", "")]), ...rest]);
      editor.setTextCursorPosition("a", "end");
      press(editor, "Delete");
      expect(editor.document.some((b: any) => b.type === "columnList")).toBe(false);
      expect(editor.getBlock("b")).toBeUndefined();
      expect(editor.document[0].id).toBe("a");
      expect(caretBlock(editor)).toBe("a");
      expect(caretOffset(editor)).toBe(1);
    }
  });

  it("1 段目が空でも寄る", () => {
    const editor = makeEditor([columns([p("a", "")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual(["a:", "b:y", "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("段組みが本文の途中にあっても、段組みの位置に行が戻る", () => {
    const editor = makeEditor([p("t", "top"), columns([p("a", "x")], [p("b", "y")]), p("z", "zz")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual(["t:top", "a:x", "b:y", "z:zz"]);
  });

  it("3 段組みなら、次の段の行が寄り、残りが 2 段以上なら段組みのまま", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y")], [p("d", "d")]), p("z", "")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual([[["a:x", "b:y"], ["d:d"]], "z:"]);
    expect(caretBlock(editor)).toBe("a");
  });

  it("2 段目に行が残るなら段組みのまま、1 つ目だけ寄る", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y"), p("c", "c")]), p("z", "")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual([[["a:x", "b:y"], ["c:c"]], "z:"]);
  });

  it("最後の段の末尾は BlockNote に任せる（段組みの後ろの行を引き込む）", () => {
    const editor = makeEditor([columns([p("a", "x")], [p("b", "y")]), p("z", "zz")]);
    editor.setTextCursorPosition("b", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual([[["a:x"], ["b:y", "z:zz"]]]);
  });

  it("段の最後の行でなければ触らない（次の行とつながる）", () => {
    const editor = makeEditor([columns([p("a", "x"), p("a2", "w")], [p("b", "y")]), p("z", "")]);
    editor.setTextCursorPosition("a", "end");
    press(editor, "Delete");
    expect(shape(editor)).toEqual([[["a:xw"], ["b:y"]], "z:"]);
  });
});
