// @vitest-environment jsdom
// 長い一覧を少しずつ描くフック: 最初の行数・目印で足す・条件が変わったら先頭に戻す
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useIncrementalRows } from "./use-incremental-rows";

type Callback = (entries: Array<{ isIntersecting: boolean }>) => void;
const observers: Callback[] = [];

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

function stubObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: Callback) { observers.push(cb); }
      observe() {}
      disconnect() {}
    },
  );
}

describe("useIncrementalRows", () => {
  it("最初は step 行まで。全体が少なければ全体", () => {
    const many = renderHook(() => useIncrementalRows(2562, "a", 200));
    expect(many.result.current.visible).toBe(200);
    expect(many.result.current.hasMore).toBe(true);
    const few = renderHook(() => useIncrementalRows(25, "a", 200));
    expect(few.result.current.visible).toBe(25);
    expect(few.result.current.hasMore).toBe(false);
  });

  it("末尾の目印が見えたら step 行ずつ足す", () => {
    stubObserver();
    const { result } = renderHook(() => useIncrementalRows(450, "a", 200));
    act(() => result.current.sentinelRef(document.createElement("tr")));
    act(() => observers[observers.length - 1]([{ isIntersecting: true }]));
    expect(result.current.visible).toBe(400);
    act(() => observers[observers.length - 1]([{ isIntersecting: true }]));
    expect(result.current.visible).toBe(450);
    expect(result.current.hasMore).toBe(false);
  });

  it("条件（resetKey）が変わったら先頭の step 行に戻す。行数だけ変わっても戻さない", () => {
    stubObserver();
    const { result, rerender } = renderHook(
      ({ total, key }) => useIncrementalRows(total, key, 200),
      { initialProps: { total: 1000, key: "claim|" } },
    );
    act(() => result.current.sentinelRef(document.createElement("tr")));
    act(() => observers[observers.length - 1]([{ isIntersecting: true }]));
    expect(result.current.visible).toBe(400);
    // 保存などで行数が変わっただけなら、読んでいる位置を保つ
    rerender({ total: 1001, key: "claim|" });
    expect(result.current.visible).toBe(400);
    // 検索語が変わったら先頭から
    rerender({ total: 1001, key: "claim|熱電" });
    expect(result.current.visible).toBe(200);
  });
});
