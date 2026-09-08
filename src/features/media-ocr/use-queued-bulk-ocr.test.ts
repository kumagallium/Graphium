// @vitest-environment jsdom
// useQueuedBulkOcr のテスト
//
// - enqueue した対象を runBulkOcr に渡して走らせる
// - 実行中に enqueue されたら同時に 2 本目を始めず、終わってから続けて回す
// - runBulkOcr はモック（実 OCR には触れない）

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ runBulkOcr: vi.fn() }));
vi.mock("./bulk-ocr", () => ({ runBulkOcr: h.runBulkOcr }));

import { useQueuedBulkOcr } from "./use-queued-bulk-ocr";

beforeEach(() => {
  h.runBulkOcr.mockReset();
});

describe("useQueuedBulkOcr", () => {
  it("enqueue した対象で runBulkOcr を 1 回呼ぶ", async () => {
    h.runBulkOcr.mockResolvedValue({ running: 0, chars: 5, empty: 0, failed: 0, aborted: false });
    const { result } = renderHook(() => useQueuedBulkOcr());

    act(() => {
      result.current.enqueue([{ fileId: "a", url: "u-a", name: "a.png" }]);
    });

    await waitFor(() => expect(h.runBulkOcr).toHaveBeenCalledTimes(1));
    expect(h.runBulkOcr).toHaveBeenCalledWith(
      [{ fileId: "a", url: "u-a", name: "a.png" }],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
  });

  it("実行中に来た分は同時に走らせず、終わってから続けて 2 本目として回す", async () => {
    let resolveFirst!: (v: unknown) => void;
    h.runBulkOcr.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; }),
    );
    h.runBulkOcr.mockResolvedValueOnce({ running: 0, chars: 0, empty: 0, failed: 0, aborted: false });

    const { result } = renderHook(() => useQueuedBulkOcr());

    act(() => {
      result.current.enqueue([{ fileId: "a", url: "u-a", name: "a.png" }]);
    });
    await waitFor(() => expect(h.runBulkOcr).toHaveBeenCalledTimes(1));

    // 1 本目が走っている間にもう 1 件来る
    act(() => {
      result.current.enqueue([{ fileId: "b", url: "u-b", name: "b.png" }]);
    });
    // まだ 1 回しか呼ばれていない（同時に 2 本走らない）
    expect(h.runBulkOcr).toHaveBeenCalledTimes(1);

    // 1 本目を終わらせる
    await act(async () => {
      resolveFirst({ running: 0, chars: 1, empty: 0, failed: 0, aborted: false });
    });

    // 終わったので続けて 2 本目（b だけ）が走る
    await waitFor(() => expect(h.runBulkOcr).toHaveBeenCalledTimes(2));
    expect(h.runBulkOcr).toHaveBeenNthCalledWith(
      2,
      [{ fileId: "b", url: "u-b", name: "b.png" }],
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
  });

  it("0 件の enqueue は何もしない", () => {
    const { result } = renderHook(() => useQueuedBulkOcr());
    act(() => {
      result.current.enqueue([]);
    });
    expect(h.runBulkOcr).not.toHaveBeenCalled();
  });
});
