// @vitest-environment jsdom
// usePushQueue（モバイル送信キューの UI 配線フック）のテスト。
//
// 対象の不変条件:
// - マウントで push モジュールを動的 import し、購読 → ready=true になる
//   （ゲート引数は無い — モバイル捕獲は正式機能なので常に立ち上がる）
// - client_id 未設定でも enqueue は成功する（キューはローカル IndexedDB。
//   未設定の案内は送信段階が出し、ローカル保存には退避しない）。false は
//   キュー自体が使えない（IndexedDB 不可）ときだけ
// - getItemFile は未送信の Blob を復元し、getItemThumbnail は履歴行のサムネイルを
//   返す（送信済みで blob を捨てた後も出る）
// - PUSH_STATUS_EVENT（設定モーダルでの client_id 変更・接続・切断）で
//   configured/connected を読み直す（ホームのチップ・キュー表示の鮮度）
//
// push モジュールはモック（実 IndexedDB / gsi には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { usePushQueue } from "./use-push-queue";
import { PUSH_STATUS_EVENT } from "./push-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 動的 import の発生自体を観測したいので、モジュールファクトリの呼び出しを数える。
// pusher の状態はテストから動かせるよう可変の knob にする。
const h = vi.hoisted(() => ({
  pushModuleLoads: vi.fn(),
  pusherConfigured: { value: false },
  getPushQueueFiles: vi.fn(async (_ids?: string[]) => [] as Array<{ id: string; file: File }>),
  getPushQueueThumbnail: vi.fn(async (_id: string) => null as Blob | null),
  enqueuePushFiles: vi.fn(async (_files?: File[]) => {}),
}));

vi.mock("./push", () => {
  h.pushModuleLoads();
  return {
    GoogleDrivePusher: class {
      isConfigured() { return h.pusherConfigured.value; }
      isConnected() { return false; }
      prepare() { return Promise.resolve(); }
    },
    subscribePushQueue: (cb: (snap: { items: never[]; draining: boolean; activeId: null }) => void) => {
      cb({ items: [], draining: false, activeId: null });
      return () => {};
    },
    enqueuePushFiles: h.enqueuePushFiles,
    drainPushQueue: vi.fn(async () => ({ pushed: [], failed: [], deferred: [], aborted: null })),
    getPushQueueFiles: h.getPushQueueFiles,
    getPushQueueThumbnail: h.getPushQueueThumbnail,
    removePushQueueItem: vi.fn(async () => {}),
    retryFailedPushItems: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  h.pusherConfigured.value = false;
});

afterEach(cleanup);

describe("usePushQueue の起動", () => {
  it("loads the push module and becomes ready on mount (no gate to satisfy)", async () => {
    const { result } = renderHook(() => usePushQueue());

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(h.pushModuleLoads).toHaveBeenCalledTimes(1);
    expect(result.current.items).toEqual([]);
  });
});

// doctrine: モバイル単独利用者はいない — 捕獲物はこの端末に退避させない。
// キューはローカル IndexedDB で動くので、client_id 未設定でも enqueue は成功し、
// 未設定の案内は送信段階（CaptureHistorySection）が出す。false（→ 呼び出し側の
// ローカル保存フォールバック）に落ちるのはキュー自体が使えないときだけ。
describe("usePushQueue の enqueue と client_id 設定の分離", () => {
  it("enqueues even when no client_id is configured (guidance happens at send time)", async () => {
    h.pusherConfigured.value = false;
    const { result } = renderHook(() => usePushQueue());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.configured).toBe(false);

    const file = new File([new Uint8Array([1]) as BlobPart], "a.jpg", { type: "image/jpeg" });
    await act(async () => {
      await expect(result.current.enqueueForSend([file])).resolves.toBe(true);
    });
    expect(h.enqueuePushFiles).toHaveBeenCalledWith([file]);
  });

  it("returns false only when the queue itself is unusable (IndexedDB failure)", async () => {
    h.enqueuePushFiles.mockRejectedValueOnce(new Error("indexeddb unavailable"));
    const { result } = renderHook(() => usePushQueue());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const file = new File([new Uint8Array([1]) as BlobPart], "a.jpg", { type: "image/jpeg" });
    await act(async () => {
      await expect(result.current.enqueueForSend([file])).resolves.toBe(false);
    });
  });
});

describe("usePushQueue のサムネイル復元と状態イベント", () => {
  it("getItemFile restores the queued blob as a File for that id", async () => {
    const file = new File([new Uint8Array([1, 2]) as BlobPart], "graphium-a.jpg", {
      type: "image/jpeg",
    });
    h.getPushQueueFiles.mockResolvedValueOnce([{ id: "a", file }]);

    const { result } = renderHook(() => usePushQueue());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      await expect(result.current.getItemFile("a")).resolves.toBe(file);
    });
    expect(h.getPushQueueFiles).toHaveBeenCalledWith(["a"]);
  });

  it("getItemThumbnail serves the stored thumbnail", async () => {
    const thumb = new Blob([new Uint8Array([9]) as BlobPart], { type: "image/jpeg" });
    h.getPushQueueThumbnail.mockResolvedValueOnce(thumb);

    const { result } = renderHook(() => usePushQueue());
    await waitFor(() => expect(result.current.ready).toBe(true));

    // 送信済みの行でもサムネは読める（blob は捨てられている）
    await act(async () => {
      await expect(result.current.getItemThumbnail("a")).resolves.toBe(thumb);
    });
    expect(h.getPushQueueThumbnail).toHaveBeenCalledWith("a");
  });

  it("re-reads configured/connected when the push status event fires", async () => {
    const { result } = renderHook(() => usePushQueue());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.configured).toBe(false);

    // 設定モーダルで client_id が保存された相当（config.ts が emit する）
    h.pusherConfigured.value = true;
    act(() => {
      window.dispatchEvent(new CustomEvent(PUSH_STATUS_EVENT));
    });
    await waitFor(() => expect(result.current.configured).toBe(true));
  });
});
