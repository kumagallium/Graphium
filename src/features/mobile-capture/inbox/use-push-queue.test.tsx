// @vitest-environment jsdom
// usePushQueue の実験フラグ（enabled 引数）ゲートのテスト。
//
// 対象の不変条件:
// - enabled=false（モバイル連携 OFF）の間は完全に不活性:
//   push モジュールの動的 import すら行わず、ready は false のまま、
//   enqueueForSend は false を返す（呼び出し側は従来のローカル保存へ落ちる）
// - enabled が true に切り替わったら、その場でロード → 購読 → ready=true になる
//   （リロード不要の反映）
//
// push モジュールはモック（実 IndexedDB / gsi には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { usePushQueue } from "./use-push-queue";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 動的 import の発生自体を観測したいので、モジュールファクトリの呼び出しを数える
const pushModuleLoads = vi.fn();

vi.mock("./push", () => {
  pushModuleLoads();
  return {
    GoogleDrivePusher: class {
      isConfigured() { return false; }
      isConnected() { return false; }
      prepare() { return Promise.resolve(); }
    },
    subscribePushQueue: (cb: (snap: { items: never[]; draining: boolean; activeId: null }) => void) => {
      cb({ items: [], draining: false, activeId: null });
      return () => {};
    },
    enqueuePushFiles: vi.fn(async () => {}),
    drainPushQueue: vi.fn(async () => ({ sent: 0, failed: 0 })),
    getPushQueueFiles: vi.fn(async () => []),
    removePushQueueItem: vi.fn(async () => {}),
    retryFailedPushItems: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("usePushQueue の enabled ゲート", () => {
  it("stays fully inert while disabled: no module load, not ready, enqueue refuses", async () => {
    const { result } = renderHook(() => usePushQueue(false));

    // マウント後もモジュールはロードされない（購読も自動 drain も起きない）
    await act(async () => { await Promise.resolve(); });
    expect(pushModuleLoads).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
    expect(result.current.items).toEqual([]);

    // enqueue は常に false（→ 呼び出し側がローカル保存へフォールバック）
    const file = new File([new Uint8Array([1]) as BlobPart], "a.jpg", { type: "image/jpeg" });
    await act(async () => {
      await expect(result.current.enqueueForSend([file])).resolves.toBe(false);
    });
    expect(pushModuleLoads).not.toHaveBeenCalled();
  });

  it("boots up in place when enabled flips to true (no reload required)", async () => {
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => usePushQueue(on), {
      initialProps: { on: false },
    });
    expect(result.current.ready).toBe(false);

    rerender({ on: true });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(pushModuleLoads).toHaveBeenCalledTimes(1);
  });
});
