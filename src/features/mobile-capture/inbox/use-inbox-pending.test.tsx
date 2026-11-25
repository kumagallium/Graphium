// @vitest-environment jsdom
// 受信箱の見張り（useInboxPending）と一覧の突き合わせ（reconcileCaptureRefs）のテスト。
//
// 対象の不変条件:
// - 中身が同じなら前の配列を返し、一部だけ変わっても変わらないアイテムの参照は使い回す
// - マウントで数え、focus・interval で数え直す。画面が隠れている間は数えない
// - 中身が変わらない再スキャンでは items の参照が変わらない（サムネイルの読み直し防止）

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import {
  INBOX_POLL_INTERVAL_MS,
  reconcileCaptureRefs,
  sameCaptureRefs,
  useInboxPending,
} from "./use-inbox-pending";
import type { CaptureRef } from "./types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A: CaptureRef = { name: "a.jpg", bytes: 1, modifiedAt: "2026-07-24T10:00:00Z" };
const B: CaptureRef = { name: "b.jpg", bytes: 2, modifiedAt: "2026-07-24T09:00:00Z" };
const C: CaptureRef = { name: "c.jpg", bytes: 3, modifiedAt: "2026-07-24T08:00:00Z" };
/** 同じ中身の別オブジェクトを作る。 */
const copy = (r: CaptureRef): CaptureRef => ({ ...r });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setVisibility("visible");
});

describe("sameCaptureRefs", () => {
  it("同じ中身なら true、長さ・順序・bytes・modifiedAt が違えば false", () => {
    expect(sameCaptureRefs([A, B], [copy(A), copy(B)])).toBe(true);
    expect(sameCaptureRefs([A], [A, B])).toBe(false);
    expect(sameCaptureRefs([A, B], [B, A])).toBe(false);
    expect(sameCaptureRefs([A], [{ ...A, bytes: 99 }])).toBe(false);
    expect(sameCaptureRefs([A], [{ ...A, modifiedAt: "2027-01-01T00:00:00Z" }])).toBe(false);
  });
});

describe("reconcileCaptureRefs", () => {
  it("全部同じなら前の配列をそのまま返す", () => {
    const prev = [A, B];
    expect(reconcileCaptureRefs(prev, [copy(A), copy(B)])).toBe(prev);
  });

  it("1 件増えたとき、変わっていないアイテムは前の参照を使い回す", () => {
    const prev = [A, B];
    const next = reconcileCaptureRefs(prev, [copy(A), copy(B), C]);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(A);
    expect(next[1]).toBe(B);
    expect(next[2]).toBe(C);
  });

  it("bytes や modifiedAt が変わったアイテムは新しい参照になる", () => {
    const prev = [A, B];
    const bChanged = { ...B, bytes: 999 };
    const aChanged = { ...A, modifiedAt: "2027-01-01T00:00:00Z" };
    const next = reconcileCaptureRefs(prev, [aChanged, bChanged]);
    expect(next[0]).toBe(aChanged);
    expect(next[1]).toBe(bChanged);
    // 片方だけ変えたとき、もう片方は使い回す
    const next2 = reconcileCaptureRefs(prev, [copy(A), bChanged]);
    expect(next2[0]).toBe(A);
    expect(next2[1]).toBe(bChanged);
  });
});

// 注意: source は参照が変わると数え直す仕様なので、renderHook の外で作って安定させる
describe("useInboxPending", () => {
  it("マウントで listPending を呼び、items に入る", async () => {
    const listPending = vi.fn(async () => [A, B]);
    const src = { listPending };
    const { result } = renderHook(() => useInboxPending(src));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(listPending).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
  });

  it("source が null なら空で、loading も false", async () => {
    const { result } = renderHook(() => useInboxPending(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("listPending が reject したら空になり、loading が false に戻る", async () => {
    const listPending = vi.fn(async (): Promise<CaptureRef[]> => {
      throw new Error("読めない");
    });
    const src = { listPending };
    const { result } = renderHook(() => useInboxPending(src));
    await waitFor(() => expect(listPending).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("window の focus イベントで数え直す", async () => {
    const listPending = vi.fn(async () => [A]);
    const src = { listPending };
    const { result } = renderHook(() => useInboxPending(src));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(listPending).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(listPending).toHaveBeenCalledTimes(2));
  });

  it("interval 経過で数え直す。画面が hidden の間は数えない", async () => {
    vi.useFakeTimers();
    const listPending = vi.fn(async () => [A]);
    const src = { listPending };
    renderHook(() => useInboxPending(src));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listPending).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_POLL_INTERVAL_MS);
    });
    expect(listPending).toHaveBeenCalledTimes(2);

    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_POLL_INTERVAL_MS * 3);
    });
    expect(listPending).toHaveBeenCalledTimes(2);

    setVisibility("visible");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INBOX_POLL_INTERVAL_MS);
    });
    expect(listPending).toHaveBeenCalledTimes(3);
  });

  it("中身が変わらない再スキャンでは items の参照が変わらない", async () => {
    // 毎回別オブジェクトで同じ中身を返す
    const listPending = vi.fn(async () => [copy(A), copy(B)]);
    const src = { listPending };
    const { result } = renderHook(() => useInboxPending(src));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const first = result.current.items;
    await act(async () => {
      await result.current.refresh();
    });
    expect(listPending).toHaveBeenCalledTimes(2);
    expect(result.current.items).toBe(first);
  });
});
