// @vitest-environment jsdom
//
// 折りたたみプラグインの振る舞い。範囲計算そのものは collapse-range.test.ts に任せ、
// ここでは「畳む・戻す・保存する・検索中は隠さない・カーソルが入ったら開く」を見る。

import { describe, it, expect, beforeEach } from "vitest";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  createHeadingBlockSpec,
} from "@blocknote/core";
import {
  collapsibleHeadingExtension,
  collapsibleHeadingKey,
  HIDDEN_CLASS,
  TOGGLE_CLASS,
} from "./collapse-plugin";
import { searchPluginKey } from "../document-search/search-plugin";
import { documentSearchExtension } from "../document-search/search-plugin";
import { COLLAPSED_STORAGE_KEY } from "./storage";

const h = (level: number, text: string, children?: any[]) => ({
  type: "heading",
  props: { level },
  content: text,
  ...(children ? { children } : {}),
});
const p = (text: string) => ({ type: "paragraph", content: text });

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      heading: createHeadingBlockSpec({ allowToggleHeadings: false }),
    } as any,
  });
  return BlockNoteEditor.create({
    schema,
    initialContent,
    extensions: [
      documentSearchExtension,
      collapsibleHeadingExtension({ collapse: "折りたたむ", expand: "展開する" }),
    ],
  } as any);
}

/** プラグインを view 付きで動かすため、実 DOM にマウントする。 */
function mount(editor: any): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor.mount(el);
  return el;
}

function stateOf(editor: any) {
  return collapsibleHeadingKey.getState(editor._tiptapEditor.state)!;
}

function idOf(editor: any, text: string): string {
  const found = editor.document.find((b: any) => {
    const c = b.content;
    return Array.isArray(c) && c[0]?.text === text;
  });
  if (!found) throw new Error(`block not found: ${text}`);
  return found.id;
}

function toggle(editor: any, id: string) {
  const view = editor._tiptapEditor.view;
  view.dispatch(view.state.tr.setMeta(collapsibleHeadingKey, { type: "toggle", id }));
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("折りたたみプラグイン", () => {
  it("畳むと配下が隠れ、もう一度で戻る", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");

    expect(stateOf(ed).ranges).toHaveLength(0);
    toggle(ed, id);
    expect(stateOf(ed).collapsed.has(id)).toBe(true);
    expect(stateOf(ed).ranges).toHaveLength(1);
    toggle(ed, id);
    expect(stateOf(ed).collapsed.has(id)).toBe(false);
    expect(stateOf(ed).ranges).toHaveLength(0);
  });

  it("隠れたブロックの DOM に class が付く", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    const el = mount(ed);
    toggle(ed, idOf(ed, "条件"));
    expect(el.querySelectorAll(`.${HIDDEN_CLASS}`).length).toBe(1);
  });

  it("畳める見出しには ▶ が付く（配下が空の見出しには付かない）", () => {
    const ed = makeEditor([h(2, "配下あり"), p("本文"), h(2, "配下なし")]);
    const el = mount(ed);
    const buttons = [...el.querySelectorAll(`.${TOGGLE_CLASS}`)];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest(".bn-block-content")?.textContent).toContain("配下あり");
  });

  it("畳んだ状態が localStorage に残り、次に開いたとき復元される", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");
    toggle(ed, id);
    expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).toContain(id);

    // 同じ内容・同じ id で開き直す（ノートを再オープンしたのと同じ状況）
    const doc = ed.document;
    const reopened = makeEditor(doc as any);
    mount(reopened);
    expect(stateOf(reopened).collapsed.has(id)).toBe(true);
    expect(stateOf(reopened).ranges.length).toBeGreaterThan(0);
  });

  it("他のノートの折りたたみ状態を消さない", () => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(["other-note-heading-id"]));
    const ed = makeEditor([h(2, "条件"), p("温度")]);
    mount(ed);
    toggle(ed, idOf(ed, "条件"));
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!);
    expect(saved).toContain("other-note-heading-id");
    expect(saved).toContain(idOf(ed, "条件"));
  });

  it("検索中は畳んだところも見える（状態は保ったまま）", () => {
    const ed = makeEditor([h(2, "条件"), p("温度は 300 K"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");
    toggle(ed, id);
    expect(stateOf(ed).ranges).toHaveLength(1);

    const view = ed._tiptapEditor.view;
    view.dispatch(
      view.state.tr.setMeta(searchPluginKey, {
        type: "set", query: "300", caseSensitive: false, activeIndex: 0,
      }),
    );
    // 隠さないが、畳んでいるという記録は残す
    expect(stateOf(ed).ranges).toHaveLength(0);
    expect(stateOf(ed).collapsed.has(id)).toBe(true);
    expect(stateOf(ed).searchActive).toBe(true);

    view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: "clear" }));
    expect(stateOf(ed).searchActive).toBe(false);
    expect(stateOf(ed).ranges).toHaveLength(1);
  });

  it("畳んだ中にカーソルが入ったら開く", () => {
    const ed = makeEditor([h(2, "条件"), p("温度は 300 K"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");
    toggle(ed, id);
    const hiddenFrom = stateOf(ed).ranges[0].from;

    ed._tiptapEditor.commands.setTextSelection(hiddenFrom + 2);
    expect(stateOf(ed).collapsed.has(id)).toBe(false);
    // 自動で開いたぶんも保存される（次に開いたときに畳まれ直さない）
    expect(JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY)!)).not.toContain(id);
  });

  it("見出しそのものにカーソルを置いても畳んだままにする", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");
    toggle(ed, id);
    ed._tiptapEditor.commands.setTextSelection(3); // 「条件」の中
    expect(stateOf(ed).collapsed.has(id)).toBe(true);
  });

  it("本文を編集しても折りたたみが解けない", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    mount(ed);
    const id = idOf(ed, "条件");
    toggle(ed, id);
    ed.insertBlocks([p("追記")] as any, ed.document[ed.document.length - 1], "after");
    expect(stateOf(ed).collapsed.has(id)).toBe(true);
    expect(stateOf(ed).ranges.length).toBeGreaterThan(0);
  });

  it("折りたたんでもノートの中身は変わらない（保存される JSON が同じ）", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    mount(ed);
    const before = JSON.stringify(ed.document);
    toggle(ed, idOf(ed, "条件"));
    expect(JSON.stringify(ed.document)).toBe(before);
  });
});
