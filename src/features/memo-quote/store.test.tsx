// @vitest-environment jsdom
// memoQuoteStore（引用したメモの紐づけのサイドストア）のテスト。
//
// 対象の不変条件:
// - 設定・取得・外す・まとめて外す。スナップショットは保存用の素の Record
// - 復元は壊れた値（captureId の無い項目）を捨て、undefined でクリアする
// - 値が変わらない操作では参照（quotes）を変えない（保存の watcher を無駄に動かさない）
// - Provider が無いとき Optional は null、必須版は throw

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoQuoteProvider, useMemoQuoteStore, useMemoQuoteStoreOptional } from "./store";
import type { MemoQuoteRef } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const wrapper = ({ children }: { children: ReactNode }) => <MemoQuoteProvider>{children}</MemoQuoteProvider>;
const ref = (id: string): MemoQuoteRef => ({ captureId: id, quotedAt: "2026-10-30T00:00:00.000Z", quotedText: "本文" });

describe("MemoQuoteProvider", () => {
  it("設定・取得・外す・スナップショット", () => {
    const { result } = renderHook(() => useMemoQuoteStore(), { wrapper });
    act(() => result.current.setQuote("b1", ref("c1")));
    act(() => result.current.setQuote("b2", ref("c2")));
    expect(result.current.getQuote("b1")).toEqual(ref("c1"));
    expect(result.current.getSnapshot()).toEqual({ b1: ref("c1"), b2: ref("c2") });
    act(() => result.current.setQuote("b1", null));
    expect(result.current.getQuote("b1")).toBeUndefined();
    expect(result.current.getSnapshot()).toEqual({ b2: ref("c2") });
  });

  it("無い id を外しても参照を変えない（保存の watcher を動かさない）", () => {
    const { result } = renderHook(() => useMemoQuoteStore(), { wrapper });
    act(() => result.current.restoreSnapshot({ a: ref("1"), b: ref("2") }));
    const before = result.current.quotes;
    act(() => result.current.setQuote("nope", null));
    expect(result.current.quotes).toBe(before);
  });

  it("復元は壊れた項目を捨て、undefined でクリアする", () => {
    const { result } = renderHook(() => useMemoQuoteStore(), { wrapper });
    act(() =>
      result.current.restoreSnapshot({
        ok: ref("c1"),
        broken: { quotedAt: "x" } as unknown as MemoQuoteRef,
        empty: { ...ref(""), captureId: "" },
        // quotedText が無い項目は残さない（残すと永久に「更新あり」になる）
        noText: { captureId: "c9", quotedAt: "x" } as unknown as MemoQuoteRef,
      }),
    );
    expect(Object.keys(result.current.getSnapshot())).toEqual(["ok"]);
    act(() => result.current.restoreSnapshot(undefined));
    expect(result.current.quotes.size).toBe(0);
  });
});

describe("Provider の外", () => {
  it("Optional は null、必須版は throw", () => {
    expect(renderHook(() => useMemoQuoteStoreOptional()).result.current).toBeNull();
    // throw は React がエラーを console に出すので、このテストの間だけ黙らせる
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useMemoQuoteStore())).toThrow();
    spy.mockRestore();
  });
});
