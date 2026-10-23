// @vitest-environment jsdom
// ノート内検索（Cmd+F）が、本文の外（音声ノートのブロックの発言など）の文字も数え、
// 本文のヒットと画面の並び順で混ぜて ↑↓ で移動できること

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook, cleanup } from "@testing-library/react";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { createSearchPlugin, searchPluginKey } from "./search-plugin";
import { SEARCH_SCOPE_ATTR, findScopeRanges } from "./block-text-search";
import { useDocumentSearch } from "./use-document-search";

// 本文の段落と、中身を文書に持たないブロック（音声ノートの代わり）だけの最小スキーマ
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "text*", toDOM: () => ["p", 0] },
    voice: {
      group: "block",
      atom: true,
      attrs: { text: { default: "" } },
      toDOM: (n) => ["div", { class: "voice" }, ["button", "天気ボタン"], ["div", { [SEARCH_SCOPE_ATTR]: "" }, n.attrs.text as string]],
    },
  },
});

function makeEditor() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("天野さんの議題")]),
    schema.node("voice", { text: "相手: 天田さんが発表。天野さんも" }),
    schema.node("paragraph", null, [schema.text("あとで天気を見る")]),
  ]);
  const place = document.createElement("div");
  document.body.appendChild(place);
  const view = new EditorView(place, { state: EditorState.create({ doc, plugins: [createSearchPlugin()] }) });
  return { editor: { _tiptapEditor: { view, on() {}, off() {} } }, view };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("本文の外の文字も検索する", () => {
  it("囲いの中だけを探す（ボタンの文字は数えない）", () => {
    const { view } = makeEditor();
    expect(findScopeRanges(view.dom, "天", false).map((r) => r.toString())).toEqual(["天", "天"]);
  });

  it("本文と囲いのヒットを並び順で数え、↑↓ で囲いの中にも移る", () => {
    const { editor, view } = makeEditor();
    const { result } = renderHook(() => useDocumentSearch(editor));
    act(() => result.current.setQuery("天"));
    // 本文 1（天野）・囲い 2（天田・天野）・本文 1（天気）
    expect(result.current.state.total).toBe(4);
    expect(result.current.state.current).toBe(1);
    expect(searchPluginKey.getState(view.state)?.activeIndex).toBe(0);

    act(() => result.current.next());
    // 2 件目は囲いの中: 本文では何も選ばない
    expect(result.current.state.current).toBe(2);
    expect(searchPluginKey.getState(view.state)?.activeIndex).toBe(-1);

    act(() => result.current.next());
    act(() => result.current.next());
    // 4 件目は 2 つ目の段落（本文の 2 件目）
    expect(result.current.state.current).toBe(4);
    expect(searchPluginKey.getState(view.state)?.activeIndex).toBe(1);

    act(() => result.current.prev());
    expect(result.current.state.current).toBe(3);
    expect(searchPluginKey.getState(view.state)?.activeIndex).toBe(-1);
  });
});
