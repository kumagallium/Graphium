// @vitest-environment jsdom
//
// 複数行のブロックが引用・Callout の中へ入ること（貼り付け）と、
// ブロック群 → 改行つきインライン本文への変換（純関数）を確かめる。
// ドロップは座標判定（elementFromPoint）が要るので実機で確認する。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { TextSelection } from "prosemirror-state";
import { calloutBlock } from "../blocks/callout";
import {
  flattenToInlineLines,
  lineInsertion,
  lineRanges,
  mergeIntoTextContainerExtension,
} from "./merge-into-text-container";

const p = (id: string, text: string, children: any[] = []) => ({
  id,
  type: "paragraph",
  content: text,
  children,
});

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: { ...defaultBlockSpecs, callout: (calloutBlock.spec as any)() } as any,
  });
  const editor = BlockNoteEditor.create({
    schema,
    initialContent,
    extensions: [mergeIntoTextContainerExtension()],
  } as any) as any;
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return editor;
}

/** id のブロック範囲を PM の Slice として切り出す（コピーされる内容と同じ形） */
function sliceOf(editor: any, ids: string[]) {
  const doc = editor._tiptapEditor.state.doc;
  let from = Infinity;
  let to = -Infinity;
  doc.descendants((n: any, pos: number) => {
    if (n.type.name === "blockContainer" && ids.includes(n.attrs.id)) {
      from = Math.min(from, pos);
      to = Math.max(to, pos + n.nodeSize);
    }
  });
  return doc.slice(from, to);
}

const texts = (editor: any) =>
  editor.document.map((b: any) => [
    b.type,
    (b.content ?? []).map((c: any) => c.text ?? c.type).join(""),
  ]);

function pasteAtEndOf(editor: any, id: string, slice: any) {
  editor.setTextCursorPosition(id, "end");
  const view = editor._tiptapEditor.view;
  let handled = false;
  view.someProp("handlePaste", (f: any) => {
    handled = handled || f(view, new Event("paste"), slice);
    return handled;
  });
  return handled;
}

describe("flattenToInlineLines", () => {
  it("段落を改行（hardBreak）でつなぎ、装飾はそのまま残す", () => {
    const editor = makeEditor([
      { id: "a", type: "paragraph", content: [{ type: "text", text: "one", styles: { bold: true } }] },
      p("b", "two"),
      p("c", "three"),
    ]);
    const schema = editor._tiptapEditor.schema;
    const flat = flattenToInlineLines(sliceOf(editor, ["a", "b", "c"]).content, schema)!;
    expect(flat.lines).toBe(3);
    const names: string[] = [];
    flat.content.forEach((n: any) => names.push(n.isText ? n.text : n.type.name));
    expect(names).toEqual(["one", "hardBreak", "two", "hardBreak", "three"]);
    expect(flat.content.firstChild!.marks.map((m: any) => m.type.name)).toEqual(["bold"]);
  });

  it("子ブロックも文書順に 1 行ずつ並べ、端の空行は落とす", () => {
    const editor = makeEditor([p("e", ""), p("a", "parent", [p("k", "child")]), p("z", "")]);
    const flat = flattenToInlineLines(
      sliceOf(editor, ["e", "a", "z"]).content,
      editor._tiptapEditor.schema,
    )!;
    expect(flat.lines).toBe(2);
    expect(flat.content.textBetween(0, flat.content.size, "", "\n")).toBe("parent\nchild");
  });

  it("画像や表が混ざると null（既定の挙動に任せる）", () => {
    const editor = makeEditor([
      p("a", "text"),
      { id: "i", type: "image", props: { url: "" } },
      { id: "t", type: "table", content: { type: "tableContent", rows: [{ cells: ["x"] }] } },
    ]);
    const schema = editor._tiptapEditor.schema;
    expect(flattenToInlineLines(sliceOf(editor, ["a", "i"]).content, schema)).toBeNull();
    expect(flattenToInlineLines(sliceOf(editor, ["a", "t"]).content, schema)).toBeNull();
  });
});

describe("貼り付け", () => {
  const blocks = () => [
    p("a", "one"),
    p("b", "two"),
    { id: "q", type: "quote", content: "quote" },
    { id: "c", type: "callout", content: "note" },
    p("tail", "tail"),
  ];

  it.each([
    ["q", "quote"],
    ["c", "callout"],
  ])("%s（%s）の中へ複数段落を貼ると、すべて改行つきで中に入る", (id, type) => {
    const editor = makeEditor(blocks());
    expect(pasteAtEndOf(editor, id, sliceOf(editor, ["a", "b"]))).toBe(true);
    const target = editor.getBlock(id);
    expect(target.type).toBe(type);
    expect(target.content.map((c: any) => c.text).join("")).toBe(
      `${id === "q" ? "quote" : "note"}one\ntwo`,
    );
    // 外に段落が出ない（末尾の空段落は BlockNote が常に補うので除く）
    expect(texts(editor).filter(([, t]: string[]) => t !== "").map(([t]: string[]) => t)).toEqual([
      "paragraph",
      "paragraph",
      "quote",
      "callout",
      "paragraph",
    ]);
  });

  it("選択範囲があれば置き換える", () => {
    const editor = makeEditor(blocks());
    const view = editor._tiptapEditor.view;
    const slice = sliceOf(editor, ["a", "b"]);
    editor.setTextCursorPosition("q", "start");
    const start = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 5)));
    view.someProp("handlePaste", (f: any) => f(view, new Event("paste"), slice));
    expect(texts(editor)[2]).toEqual(["quote", "one\ntwo"]);
  });

  it("段落の中・1 行だけの貼り付けは既定の処理に任せる", () => {
    const editor = makeEditor(blocks());
    expect(pasteAtEndOf(editor, "tail", sliceOf(editor, ["a", "b"]))).toBe(false);
    expect(pasteAtEndOf(editor, "q", sliceOf(editor, ["a"]))).toBe(false);
  });
});

describe("行の前後へ入れる位置", () => {
  /** id のブロックの本文ノードと、本文の先頭位置 */
  function textblockOf(editor: any, id: string) {
    let found: any = null;
    editor._tiptapEditor.state.doc.descendants((n: any, pos: number) => {
      if (found) return false;
      if (n.type.name === "blockContainer" && n.attrs.id === id) {
        found = { node: n.firstChild, start: pos + 2 };
        return false;
      }
      return true;
    });
    return found;
  }

  /** 位置へ入れた結果の本文テキスト（改行は \n） */
  function applyAt(editor: any, id: string, index: number, side: "before" | "after") {
    const view = editor._tiptapEditor.view;
    const { node, start } = textblockOf(editor, id);
    const flat = flattenToInlineLines(sliceOf(editor, ["a"]).content, view.state.schema)!;
    const ins = lineInsertion(node, lineRanges(node, start)[index], side, flat.content, view.state.schema);
    view.dispatch(view.state.tr.insert(ins.pos, ins.content));
    return editor.getBlock(id).content.map((c: any) => c.text).join("");
  }

  const make = (body: string) =>
    makeEditor([p("a", "new"), { id: "c", type: "callout", content: body }]);

  it("改行で区切った行の範囲を返す", () => {
    const editor = make("one\ntwo\nthree");
    const { node, start } = textblockOf(editor, "c");
    const ranges = lineRanges(node, start);
    expect(ranges).toHaveLength(3);
    const doc = editor._tiptapEditor.state.doc;
    expect(ranges.map((r) => doc.textBetween(r.from, r.to))).toEqual(["one", "two", "three"]);
  });

  it.each([
    [0, "before", "new\none\ntwo\nthree"],
    [0, "after", "one\nnew\ntwo\nthree"],
    [1, "after", "one\ntwo\nnew\nthree"],
    [2, "after", "one\ntwo\nthree\nnew"],
  ] as const)("%i 行目の %s に入る", (index, side, expected) => {
    expect(applyAt(make("one\ntwo\nthree"), "c", index, side)).toBe(expected);
  });

  it("本文が空なら改行を付けない", () => {
    expect(applyAt(make(""), "c", 0, "after")).toBe("new");
  });
});
