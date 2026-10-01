// @vitest-environment jsdom
//
// 直前の色（⌘⇧H / Ctrl+Shift+H）の結合テスト
//
// 本物の BlockNoteEditor を組み立てて、色メニューと同じ addStyles で付けた色を覚えること、
// ショートカットでその色を付け外しすること、貼り付け・取り消しの色は覚えないことを確かめる。

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import {
  DEFAULT_LAST_COLOR,
  applyRepeatColor,
  getLastColor,
  handleRepeatColorShortcut,
  installRepeatColorBrowserGuard,
  lastColorFromTransaction,
  resetLastColorForTest,
  setLastColor,
  watchLastColor,
} from "./repeat-color";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (content: any[]) => ({ type: "paragraph", props: {}, content, children: [] });
const firstContent = (editor: any) => editor.document[0].content;

const mounted: { host: HTMLElement; stop: () => void }[] = [];
function mountEditor(initialContent: any[]) {
  const editor = BlockNoteEditor.create({ initialContent } as any) as any;
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor.mount(host);
  mounted.push({ host, stop: watchLastColor(editor) });
  return editor;
}

beforeEach(() => resetLastColorForTest());
afterEach(() => {
  for (const { host, stop } of mounted.splice(0)) {
    stop();
    host.remove();
  }
  resetLastColorForTest();
});

/** 本文中の文字列を選択する（1 つのテキストノード内にあること） */
function selectText(editor: any, needle: string) {
  const tiptap = editor._tiptapEditor;
  let from = -1;
  tiptap.state.doc.descendants((node: any, pos: number) => {
    if (from >= 0) return false;
    if (node.isText) {
      const i = node.text.indexOf(needle);
      if (i >= 0) from = pos + i;
    }
    return true;
  });
  if (from < 0) throw new Error(`text not found: ${needle}`);
  tiptap.commands.setTextSelection({ from, to: from + needle.length });
}

function keydown(init: KeyboardEventInit) {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("直前の色を覚える", () => {
  it("まだ色を使っていなければ黄色の背景", () => {
    expect(getLastColor()).toEqual(DEFAULT_LAST_COLOR);
    expect(DEFAULT_LAST_COLOR).toEqual({ style: "backgroundColor", color: "yellow" });
  });

  it("色メニューと同じ addStyles で付けた文字色・背景色を覚える", () => {
    const editor = mountEditor([para([text("alpha beta")])]);
    selectText(editor, "alpha");
    editor.addStyles({ textColor: "red" });
    expect(getLastColor()).toEqual({ style: "textColor", color: "red" });
    selectText(editor, "beta");
    editor.addStyles({ backgroundColor: "blue" });
    expect(getLastColor()).toEqual({ style: "backgroundColor", color: "blue" });
  });

  it("色を外した（既定に戻した）ときは直前の色を変えない", () => {
    const editor = mountEditor([para([text("alpha", { textColor: "red" })])]);
    setLastColor({ style: "textColor", color: "green" });
    selectText(editor, "alpha");
    editor.removeStyles({ textColor: "red" });
    expect(getLastColor()).toEqual({ style: "textColor", color: "green" });
  });

  it("取り消しで戻ってきた色は覚えない", () => {
    const editor = mountEditor([para([text("alpha", { textColor: "red" })])]);
    setLastColor({ style: "textColor", color: "green" });
    selectText(editor, "alpha");
    editor.removeStyles({ textColor: "red" });
    editor.undo();
    expect(firstContent(editor)[0].styles).toEqual({ textColor: "red" });
    expect(getLastColor()).toEqual({ style: "textColor", color: "green" });
  });

  it("貼り付け・ドロップのトランザクションと色以外のマークは拾わない", () => {
    const addMark = (type: string, stringValue?: string) => ({
      toJSON: () => ({ stepType: "addMark", mark: { type, attrs: stringValue ? { stringValue } : {} } }),
    });
    const tr = (steps: any[], meta: Record<string, unknown> = {}) => ({
      docChanged: true,
      steps,
      getMeta: (k: string) => meta[k],
    });
    expect(lastColorFromTransaction(tr([addMark("textColor", "red")]))).toEqual({
      style: "textColor",
      color: "red",
    });
    expect(lastColorFromTransaction(tr([addMark("textColor", "red")], { paste: true }))).toBeNull();
    expect(lastColorFromTransaction(tr([addMark("textColor", "red")], { uiEvent: "drop" }))).toBeNull();
    expect(lastColorFromTransaction(tr([addMark("bold")]))).toBeNull();
    // パレットに無い値・「既定」は覚えない
    expect(lastColorFromTransaction(tr([addMark("textColor", "default")]))).toBeNull();
    expect(lastColorFromTransaction(tr([addMark("backgroundColor", "#ff0000")]))).toBeNull();
  });

  it("壊れた保存値は無視して黄色の背景に戻る", () => {
    localStorage.setItem("graphium-last-color", JSON.stringify({ style: "bold", color: "red" }));
    expect(getLastColor()).toEqual(DEFAULT_LAST_COLOR);
    resetLastColorForTest();
    localStorage.setItem("graphium-last-color", "{not json");
    expect(getLastColor()).toEqual(DEFAULT_LAST_COLOR);
  });

  it("覚えた色は localStorage に残る（再起動後も同じ色）", () => {
    setLastColor({ style: "textColor", color: "purple" });
    expect(JSON.parse(localStorage.getItem("graphium-last-color")!)).toEqual({
      style: "textColor",
      color: "purple",
    });
  });
});

describe("⌘⇧H で直前の色を付け外しする", () => {
  it("未使用なら選択範囲に黄色の背景を付け、もう一度で外す", () => {
    const editor = mountEditor([para([text("alpha beta")])]);
    selectText(editor, "alpha");
    expect(applyRepeatColor(editor)).toBe(true);
    expect(firstContent(editor)).toEqual([
      text("alpha", { backgroundColor: "yellow" }),
      text(" beta"),
    ]);
    selectText(editor, "alpha");
    applyRepeatColor(editor);
    expect(firstContent(editor)).toEqual([text("alpha beta")]);
  });

  it("色メニューで選んだ色が以後のショートカットの色になる", () => {
    const editor = mountEditor([para([text("alpha beta")])]);
    selectText(editor, "alpha");
    editor.addStyles({ textColor: "red" });
    selectText(editor, "beta");
    applyRepeatColor(editor);
    expect(firstContent(editor)).toEqual([
      text("alpha", { textColor: "red" }),
      text(" "),
      text("beta", { textColor: "red" }),
    ]);
  });

  it("別の文字色が付いていれば直前の色に置き換える", () => {
    const editor = mountEditor([para([text("alpha", { textColor: "blue" })])]);
    setLastColor({ style: "textColor", color: "red" });
    selectText(editor, "alpha");
    applyRepeatColor(editor);
    expect(firstContent(editor)).toEqual([text("alpha", { textColor: "red" })]);
  });

  it("keydown は ⌘⇧H / Ctrl+Shift+H（物理キー H）だけを処理する", () => {
    const editor = mountEditor([para([text("alpha")])]);
    selectText(editor, "alpha");
    expect(handleRepeatColorShortcut(editor, keydown({ code: "KeyH", key: "h", metaKey: true }))).toBe(false);
    expect(
      handleRepeatColorShortcut(editor, keydown({ code: "KeyH", key: "H", metaKey: true, shiftKey: true, altKey: true })),
    ).toBe(false);
    expect(
      handleRepeatColorShortcut(editor, keydown({ code: "KeyG", key: "G", metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(firstContent(editor)).toEqual([text("alpha")]);
    expect(
      handleRepeatColorShortcut(editor, keydown({ code: "KeyH", key: "H", ctrlKey: true, shiftKey: true })),
    ).toBe(true);
    expect(firstContent(editor)).toEqual([text("alpha", { backgroundColor: "yellow" })]);
  });

  it("本文の外（タイトル欄など）で押してもブラウザ既定（ホーム移動・履歴）を止める", () => {
    const stop = installRepeatColorBrowserGuard();
    const input = document.createElement("input");
    document.body.appendChild(input);
    let reachedTarget = false;
    input.addEventListener("keydown", () => (reachedTarget = true));
    try {
      const ev = keydown({ code: "KeyH", key: "H", metaKey: true, shiftKey: true });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      // 伝播は止めない（エディタ側の色付けはそのまま走る）
      expect(reachedTarget).toBe(true);
      const other = keydown({ code: "KeyG", key: "G", metaKey: true, shiftKey: true });
      input.dispatchEvent(other);
      expect(other.defaultPrevented).toBe(false);
    } finally {
      stop();
      input.remove();
    }
    const afterStop = keydown({ code: "KeyH", key: "H", metaKey: true, shiftKey: true });
    document.body.dispatchEvent(afterStop);
    expect(afterStop.defaultPrevented).toBe(false);
  });

  it("ブラウザ既定を止めた後でもエディタ側の色付けは効く", () => {
    const stop = installRepeatColorBrowserGuard();
    try {
      const editor = mountEditor([para([text("alpha")])]);
      selectText(editor, "alpha");
      const ev = keydown({ code: "KeyH", key: "H", metaKey: true, shiftKey: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
      expect(handleRepeatColorShortcut(editor, ev)).toBe(true);
      expect(firstContent(editor)).toEqual([text("alpha", { backgroundColor: "yellow" })]);
    } finally {
      stop();
    }
  });

  it("読み取り専用のエディタでは何もしない", () => {
    const editor = mountEditor([para([text("alpha")])]);
    selectText(editor, "alpha");
    editor.isEditable = false;
    expect(applyRepeatColor(editor)).toBe(false);
    expect(firstContent(editor)).toEqual([text("alpha")]);
  });
});
