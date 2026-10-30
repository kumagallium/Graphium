// @vitest-environment jsdom
// useQuoteBlockIds（近傍グラフ用に、本文にある quote ブロックの ID を本文の変化へ追従して返すフック）のテスト。
//
// 対象の不変条件:
// - 子ブロックを含む quote ブロックの ID だけを返す（段落などは含めない）
// - 本文の変更通知のあと（少し待って 1 回にまとめて）読み直す。キー入力で引用ブロックを消すと外れる
// - 値が同じ間は同じ配列を返す。enabled=false では空で、通知も購読しない

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QUOTE_BLOCK_IDS_DEBOUNCE_MS, useQuoteBlockIds } from "./use-quote-block-ids";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function fakeEditor(initial: any[]) {
  let listener: (() => void) | null = null;
  const off = vi.fn();
  const editor = {
    document: initial,
    onEditorContentChange: (cb: () => void) => {
      listener = cb;
      return off;
    },
  };
  return { editor, off, fire: () => listener?.() };
}

describe("useQuoteBlockIds", () => {
  it("子ブロックを含む quote ブロックの ID だけを返す", () => {
    const { editor } = fakeEditor([
      { id: "q1", type: "quote" },
      { id: "p1", type: "paragraph", children: [{ id: "q2", type: "quote" }] },
    ]);
    const { result } = renderHook(() => useQuoteBlockIds(editor, true));
    expect([...result.current].sort()).toEqual(["q1", "q2"]);
  });

  it("本文が変わると、少し待って読み直す（キー入力で引用ブロックを消した場合）", () => {
    const { editor, fire } = fakeEditor([{ id: "q1", type: "quote" }]);
    const { result } = renderHook(() => useQuoteBlockIds(editor, true));
    expect(result.current).toEqual(["q1"]);
    editor.document = [{ id: "p1", type: "paragraph" }];
    fire();
    expect(result.current).toEqual(["q1"]); // まだ待っている
    act(() => {
      vi.advanceTimersByTime(QUOTE_BLOCK_IDS_DEBOUNCE_MS + 1);
    });
    expect(result.current).toEqual([]);
  });

  it("値が同じ間は同じ配列を返す", () => {
    const { editor, fire } = fakeEditor([{ id: "q1", type: "quote" }]);
    const { result, rerender } = renderHook(() => useQuoteBlockIds(editor, true));
    const first = result.current;
    rerender();
    fire();
    act(() => {
      vi.advanceTimersByTime(QUOTE_BLOCK_IDS_DEBOUNCE_MS + 1);
    });
    expect(result.current).toBe(first);
  });

  it("enabled=false では空で、購読しない。外すと購読を解く", () => {
    const { editor, off } = fakeEditor([{ id: "q1", type: "quote" }]);
    const spy = vi.spyOn(editor, "onEditorContentChange");
    const { result, rerender, unmount } = renderHook(({ on }) => useQuoteBlockIds(editor, on), {
      initialProps: { on: false },
    });
    expect(result.current).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
    rerender({ on: true });
    expect(result.current).toEqual(["q1"]);
    unmount();
    expect(off).toHaveBeenCalled();
  });
});
