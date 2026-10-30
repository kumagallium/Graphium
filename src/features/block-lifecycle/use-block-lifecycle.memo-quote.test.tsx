// @vitest-environment jsdom
// useBlockLifecycle とメモの引用の紐づけ（memoQuotes）のテスト。
//
// 対象の不変条件:
// - ブロックを消す前の removeBlockMetadata は紐づけに触らない（経路で挙動が分かれず、Undo で紐づけごと戻る。
//   本文に無い紐づけは読む側が無視し、保存で落とす）
// - 複製（copyBlocksMetadata）は新しいブロックにも同じ元のメモへの紐づけを付ける（元の紐づけは残す）
// - MemoQuoteProvider が無い画面（共有ノートなど）でも落ちない

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { LabelStoreProvider, ProvLabelsEnabledProvider } from "../context-label/store";
import { LinkStoreProvider } from "../block-link/store";
import { MemoQuoteProvider, useMemoQuoteStore } from "../memo-quote/store";
import { useBlockLifecycle } from "./use-block-lifecycle";
import type { MemoQuoteRef } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ref = (id: string): MemoQuoteRef => ({ captureId: id, quotedAt: "2026-10-30T00:00:00.000Z", quotedText: "本文" });

const withProviders =
  (withQuotes: boolean) =>
  ({ children }: { children: ReactNode }) => {
    const inner = (
      <ProvLabelsEnabledProvider enabled>
        <LabelStoreProvider>
          <LinkStoreProvider>{children}</LinkStoreProvider>
        </LabelStoreProvider>
      </ProvLabelsEnabledProvider>
    );
    return withQuotes ? <MemoQuoteProvider>{inner}</MemoQuoteProvider> : inner;
  };

function setup() {
  return renderHook(
    () => ({ lifecycle: useBlockLifecycle(), quotes: useMemoQuoteStore() }),
    { wrapper: withProviders(true) },
  );
}

describe("useBlockLifecycle × memoQuotes", () => {
  it("removeBlockMetadata は紐づけに触らない（Undo で戻るブロックの紐づけを残す）", () => {
    const { result } = setup();
    act(() => result.current.quotes.restoreSnapshot({ a: ref("c1"), b: ref("c2") }));
    act(() => result.current.lifecycle.removeBlockMetadata(["a"]));
    expect(result.current.quotes.getSnapshot()).toEqual({ a: ref("c1"), b: ref("c2") });
  });

  it("copyBlocksMetadata は複製先にも同じメモへの紐づけを付ける（元は残す）", () => {
    const { result } = setup();
    act(() => result.current.quotes.restoreSnapshot({ a: ref("c1") }));
    act(() => result.current.lifecycle.copyBlocksMetadata(new Map([["a", "a2"], ["plain", "plain2"]])));
    expect(result.current.quotes.getSnapshot()).toEqual({ a: ref("c1"), a2: ref("c1") });
  });

  it("MemoQuoteProvider が無くても落ちない", () => {
    const { result } = renderHook(() => useBlockLifecycle(), { wrapper: withProviders(false) });
    expect(() => result.current.removeBlockMetadata(["a"])).not.toThrow();
    expect(() => result.current.copyBlocksMetadata(new Map([["a", "b"]]))).not.toThrow();
  });
});
