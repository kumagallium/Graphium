// @vitest-environment jsdom
// 同意の単位（scope）の回帰ガード
//
// 同意は「いま開いているエディタ 1 つ」に紐づく。ノート ID から scope を作ると 2 つ壊れる:
//
//   1. 未保存のノートは ID を持たない。ID が無いときの固定値（"new" のような文字列）を
//      使うと、どの新規ノートも同じ scope になり、片方で押した同意がもう片方に効く。
//      —— 未保存のノートで「読み込む」を押した後、そのまま次の新規ノートに他人から
//      もらった断片を貼ると、同意していないのに配信元へ要求が出る。
//   2. 新規ノートは自動保存で ID が付く。その瞬間に scope が変わると、押した同意が
//      黙って外れ、取り込み中の画像は書き戻し先を失う（後者は
//      use-remote-image-import.test.tsx が見る）。
//
// 代わりに useRemoteContentScope がエディタ 1 回分の値を作る。ノートを開き直すたびに
// 新しい値になるので、同意はそのノートを開いている間だけ生きる。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  allowRemoteContentFor,
  blockedRemoteCount,
  isRemoteContentAllowed,
  registerBlockedRemoteBlock,
  resetRemoteContentGate,
  useRemoteContentScope,
} from "./store";

beforeEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

afterEach(() => {
  resetRemoteContentGate();
  localStorage.clear();
});

describe("同意の単位（useRemoteContentScope）", () => {
  it("別々の未保存ノートは同意を共有しない", () => {
    // 1 つめの新規ノート: 「外部画像を読み込む」を押す
    const first = renderHook(() => useRemoteContentScope());
    const firstScope = first.result.current;
    act(() => allowRemoteContentFor(firstScope));
    expect(isRemoteContentAllowed(firstScope)).toBe(true);
    first.unmount();

    // 2 つめの新規ノート（どちらも fileId を持たない）
    const second = renderHook(() => useRemoteContentScope());
    const secondScope = second.result.current;

    expect(secondScope).not.toBe(firstScope);
    expect(isRemoteContentAllowed(secondScope)).toBe(false);
    second.unmount();
  });

  it("保存でノート id が付いても scope は変わらず、同意も外れない", () => {
    // note-app.tsx の配線: fileId は受け取るが scope はそこから作らない
    const { result, rerender, unmount } = renderHook(
      (_props: { fileId: string | null }) => useRemoteContentScope(),
      { initialProps: { fileId: null } as { fileId: string | null } },
    );
    const scope = result.current;
    act(() => allowRemoteContentFor(scope));

    // 未採番のノートが自動保存され、id が付く（use-file-manager の「新規作成」分岐）
    rerender({ fileId: "real-file-id" });

    expect(result.current).toBe(scope);
    expect(isRemoteContentAllowed(scope)).toBe(true);
    unmount();
  });

  it("同じノートを開き直すと、また同意を求める", () => {
    // 同意はセッション限り・エディタ 1 回分。開き直しはメールの添付を開き直すのと
    // 同じで、同じ URL が同じものを返す保証はないため、もう一度押してもらう。
    const opened = renderHook(() => useRemoteContentScope());
    const openedScope = opened.result.current;
    act(() => allowRemoteContentFor(openedScope));
    opened.unmount();

    const reopened = renderHook(() => useRemoteContentScope());
    expect(isRemoteContentAllowed(reopened.result.current)).toBe(false);
    reopened.unmount();
  });

  it("閉じたエディタの同意とブロック件数を残さない", () => {
    const { result, unmount } = renderHook(() => useRemoteContentScope());
    const scope = result.current;
    registerBlockedRemoteBlock(scope, "block-1");
    act(() => allowRemoteContentFor(scope));
    expect(isRemoteContentAllowed(scope)).toBe(true);

    unmount();

    expect(isRemoteContentAllowed(scope)).toBe(false);
    expect(blockedRemoteCount(scope)).toBe(0);
  });
});
