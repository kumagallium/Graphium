import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers: Record<string, (e: any) => void> = {};
vi.mock("./api", () => ({
  getPermission: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getStatus: vi.fn(),
  onLevel: vi.fn(async (cb) => { handlers.level = cb; return () => {}; }),
  onError: vi.fn(async (cb) => { handlers.error = cb; return () => {}; }),
  onStopped: vi.fn(async (cb) => { handlers.stopped = cb; return () => {}; }),
}));

import * as api from "./api";
import * as store from "./store";

const stopResult = { id: "r1", systemFileId: "s1", micFileId: "m1", durationMs: 5000, droppedPackets: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  store.__resetForTest();
  vi.mocked(api.getPermission).mockResolvedValue({ screen: "granted", mic: "granted" });
  vi.mocked(api.startRecording).mockResolvedValue({ id: "r1", startedAt: "2026-10-19T00:00:00Z" });
  vi.mocked(api.stopRecording).mockResolvedValue(stopResult);
});

describe("meeting-recorder store", () => {
  it("openConfirm で confirming になり権限を読む", async () => {
    await store.openConfirm();
    expect(store.getState().phase).toBe("confirming");
    expect(store.getState().permission?.screen).toBe("granted");
  });

  it("cancelConfirm で idle に戻る", async () => {
    await store.openConfirm();
    store.cancelConfirm();
    expect(store.getState().phase).toBe("idle");
  });

  it("start 成功で recording になる", async () => {
    await store.openConfirm();
    await store.start();
    expect(store.getState().phase).toBe("recording");
    expect(store.getState().id).toBe("r1");
    store.__resetForTest();
  });

  it("画面収録が denied なら error になり録音を始めない", async () => {
    vi.mocked(api.getPermission).mockResolvedValue({ screen: "denied", mic: "granted" });
    await store.start();
    expect(store.getState().phase).toBe("error");
    expect(store.getState().error?.kind).toBe("permissionDenied");
    expect(api.startRecording).not.toHaveBeenCalled();
  });

  it("start が失敗したら error", async () => {
    vi.mocked(api.startRecording).mockRejectedValue(new Error("boom"));
    await store.start();
    expect(store.getState().phase).toBe("error");
    expect(store.getState().error?.kind).toBe("failed");
  });

  it("stop の結果を保持して idle に戻る", async () => {
    await store.start();
    await store.stop();
    expect(store.getState().phase).toBe("idle");
    expect(store.getState().result).toEqual(stopResult);
    store.clearResult();
    expect(store.getState().result).toBeNull();
  });

  it("level イベントでレベルと経過時間が反映される", async () => {
    await store.start();
    handlers.level({ id: "r1", elapsedMs: 1500, system: 0.2, mic: 0.1 });
    expect(store.getState().level).toEqual({ system: 0.2, mic: 0.1 });
    expect(store.getState().elapsedMs).toBe(1500);
    // 別 ID は無視
    handlers.level({ id: "other", elapsedMs: 9999, system: 1, mic: 1 });
    expect(store.getState().elapsedMs).toBe(1500);
    await store.stop();
  });

  it("limit で止まったら停止を呼んで結果と理由を保持する", async () => {
    await store.start();
    handlers.stopped({ id: "r1", reason: "limit", result: null });
    await vi.waitFor(() => expect(store.getState().phase).toBe("idle"));
    expect(api.stopRecording).toHaveBeenCalledTimes(1);
    expect(store.getState().stopReason).toBe("limit");
    expect(store.getState().result?.id).toBe("r1");
  });

  it("error イベントでメッセージを持つ", async () => {
    await store.start();
    handlers.error({ id: "r1", message: "device lost" });
    expect(store.getState().error?.message).toBe("device lost");
    await store.stop();
  });

  it("starting 中に届いた error は id が一致すれば start 後に反映される", async () => {
    await store.openConfirm();
    vi.mocked(api.startRecording).mockImplementation(async () => {
      handlers.error({ id: "r1", message: "track failed" });
      return { id: "r1", startedAt: "x" };
    });
    await store.start();
    expect(store.getState().phase).toBe("recording");
    expect(store.getState().error).toMatchObject({ context: "recording", message: "track failed" });
    await store.stop();
  });

  it("starting 中に届いた古い id の error は捨てる", async () => {
    await store.openConfirm();
    vi.mocked(api.startRecording).mockImplementation(async () => {
      handlers.error({ id: "old", message: "stale" });
      return { id: "r1", startedAt: "x" };
    });
    await store.start();
    expect(store.getState().error).toBeNull();
    await store.stop();
  });

  it("stopped に result があれば stop を呼ばずそのまま保持する", async () => {
    await store.start();
    handlers.stopped({ id: "r1", reason: "limit", result: stopResult });
    expect(api.stopRecording).not.toHaveBeenCalled();
    expect(store.getState().phase).toBe("idle");
    expect(store.getState().result).toEqual(stopResult);
    expect(store.getState().stopReason).toBe("limit");
  });

  it("stop の失敗は context: stop の error になる（トースト経路）", async () => {
    await store.start();
    vi.mocked(api.stopRecording).mockRejectedValue(new Error("boom"));
    await store.stop();
    expect(store.getState().phase).toBe("error");
    expect(store.getState().error?.context).toBe("stop");
    store.dismissError();
    expect(store.getState().phase).toBe("idle");
  });

  it("上限停止が先行し手動 stop が not recording で失敗しても stopped の result を採用する", async () => {
    await store.start();
    vi.mocked(api.stopRecording).mockRejectedValue(new Error("not recording"));
    await store.stop();
    expect(store.getState().phase).toBe("stopping");
    handlers.stopped({ id: "r1", reason: "limit", result: stopResult });
    expect(store.getState().phase).toBe("idle");
    expect(store.getState().result).toEqual(stopResult);
    expect(store.getState().stopReason).toBe("limit");
  });

  it("not recording のあと stopped が来なければ 5 秒で stop 失敗になる", async () => {
    vi.useFakeTimers();
    try {
      await store.start();
      vi.mocked(api.stopRecording).mockRejectedValue(new Error("not recording"));
      await store.stop();
      vi.advanceTimersByTime(5100);
      expect(store.getState().phase).toBe("error");
      expect(store.getState().error?.context).toBe("stop");
    } finally {
      vi.useRealTimers();
    }
  });

  it("権限は openConfirm で request:false、start で request:true", async () => {
    await store.openConfirm();
    expect(api.getPermission).toHaveBeenLastCalledWith({ request: false });
    await store.start();
    expect(api.getPermission).toHaveBeenLastCalledWith({ request: true });
    await store.stop();
  });
});
