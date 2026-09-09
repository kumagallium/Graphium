// @vitest-environment jsdom
// use-list-search-hotkey のテスト。
// 「見えている一覧の検索欄にだけフォーカスを送り、他の誰かが先に取った Cmd+F や
// 入力中の欄からは奪わない」という譲り合いの条件を固定する。
// jsdom はレイアウトを持たず getClientRects() が常に空なので、可視性は個別に差し替える。

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { useListSearchHotkey, LIST_SEARCH_ATTR } from "./use-list-search-hotkey";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 検索欄を 1 つ生やす。visible=false なら「画面に出ていない」扱いにする。 */
function addSearchInput(visible = true): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.setAttribute(LIST_SEARCH_ATTR, "");
  el.getClientRects = (() =>
    (visible ? [{}] : []) as unknown as DOMRectList) as HTMLElement["getClientRects"];
  document.body.appendChild(el);
  return el;
}

/** Cmd+F を document に流し、preventDefault されたかを返す。 */
function pressCmdF(opts: { shiftKey?: boolean; ctrl?: boolean; defaultPrevented?: boolean } = {}) {
  const e = new KeyboardEvent("keydown", {
    key: "f",
    metaKey: !opts.ctrl,
    ctrlKey: !!opts.ctrl,
    shiftKey: !!opts.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  if (opts.defaultPrevented) e.preventDefault();
  document.dispatchEvent(e);
  return e.defaultPrevented;
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  // 前のテストの購読が残ると「unmount で外れる」判定が通らないので毎回畳む
  cleanup();
  document.body.innerHTML = "";
});

describe("useListSearchHotkey", () => {
  it("見えている検索欄にフォーカスを送る", () => {
    renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    input.value = "既存の語";
    expect(pressCmdF()).toBe(true);
    expect(document.activeElement).toBe(input);
    // 続けて打ち直せるよう全選択する
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("Ctrl+F でも効く", () => {
    renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    expect(pressCmdF({ ctrl: true })).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("一覧が出ていなければ何もしない（ブラウザ標準に委ねる）", () => {
    renderHook(() => useListSearchHotkey());
    addSearchInput(false);
    expect(pressCmdF()).toBe(false);
  });

  it("本文・PDF 検索が先に取っていたら何もしない", () => {
    renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    pressCmdF({ defaultPrevented: true });
    expect(document.activeElement).not.toBe(input);
  });

  it("Cmd+Shift+F は別のショートカットなので拾わない", () => {
    renderHook(() => useListSearchHotkey());
    addSearchInput();
    expect(pressCmdF({ shiftKey: true })).toBe(false);
  });

  it("他の入力欄で編集中なら奪わない", () => {
    renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    const other = document.createElement("textarea");
    document.body.appendChild(other);
    other.focus();
    expect(pressCmdF()).toBe(false);
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(input);
  });

  it("既に検索欄に居るときは選び直す", () => {
    renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    input.value = "abc";
    input.focus();
    input.setSelectionRange(3, 3);
    expect(pressCmdF()).toBe(true);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(3);
  });

  it("複数見えているときは DOM 順で後のもの（重なった側）を採る", () => {
    renderHook(() => useListSearchHotkey());
    addSearchInput();
    const later = addSearchInput();
    pressCmdF();
    expect(document.activeElement).toBe(later);
  });

  it("unmount 後は購読を外す", () => {
    const { unmount } = renderHook(() => useListSearchHotkey());
    const input = addSearchInput();
    unmount();
    expect(pressCmdF()).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });
});
