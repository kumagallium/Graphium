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
  onTranscribeSegment: vi.fn(async (cb) => { handlers.tsegment = cb; return () => {}; }),
  onTranscribeProgress: vi.fn(async (cb) => { handlers.tprogress = cb; return () => {}; }),
  onTranscribeDone: vi.fn(async (cb) => { handlers.tdone = cb; return () => {}; }),
  onTranscribeError: vi.fn(async (cb) => { handlers.terror = cb; return () => {}; }),
  onTranscribeCancelled: vi.fn(async (cb) => { handlers.tcancel = cb; return () => {}; }),
  startTranscribe: vi.fn(),
}));

import * as api from "./api";
import * as store from "./store";

const stopResult = { id: "r1", fileId: "f1", tracks: { system: true, mic: true }, durationMs: 5000, droppedPackets: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  store.__resetForTest();
  vi.mocked(api.getPermission).mockResolvedValue({ screen: "granted", mic: "granted" });
  vi.mocked(api.startRecording).mockResolvedValue({ id: "r1", fileId: "f1", startedAt: "2026-10-19T00:00:00Z" });
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
      return { id: "r1", fileId: "f1", startedAt: "x" };
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
      return { id: "r1", fileId: "f1", startedAt: "x" };
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
    expect(api.getPermission).toHaveBeenLastCalledWith({ request: false, captureSystem: true });
    await store.start();
    expect(api.getPermission).toHaveBeenLastCalledWith({ request: true, captureSystem: true });
    await store.stop();
  });

  it("相手の声を録らない設定: 画面収録が denied でも始まり、captureSystem=false が渡る", async () => {
    vi.mocked(api.getPermission).mockResolvedValue({ screen: "denied", mic: "granted" });
    store.setCaptureSystem(false);
    await store.start();
    expect(api.getPermission).toHaveBeenLastCalledWith({ request: true, captureSystem: false });
    expect(api.startRecording).toHaveBeenCalledWith(expect.objectContaining({ captureSystem: false }));
    expect(store.getState().phase).toBe("recording");
    expect(store.getState().startInfo?.captureSystem).toBe(false);
    await store.stop();
  });

  describe("startFromBlock（ブロックの「録音を始める」）", () => {
    it("成功: 録音の情報を返し、startInfo.attachToBlockId に印が付く。通常の start には付かない", async () => {
      const info = await store.startFromBlock("blk1");
      expect(info).toEqual({ id: "r1", fileId: "f1", startedAt: "2026-10-19T00:00:00Z" });
      expect(store.getState().phase).toBe("recording");
      expect(store.getState().startInfo?.attachToBlockId).toBe("blk1");
      await store.stop();
      await store.start();
      expect(store.getState().startInfo?.attachToBlockId).toBeUndefined();
      await store.stop();
    });

    it("画面収録が denied なら null を返し、従来のダイアログ（error 状態）に案内を任せる", async () => {
      vi.mocked(api.getPermission).mockResolvedValue({ screen: "denied", mic: "granted" });
      expect(await store.startFromBlock("blk1")).toBeNull();
      expect(store.getState().phase).toBe("error");
      expect(store.getState().error?.kind).toBe("permissionDenied");
      expect(api.startRecording).not.toHaveBeenCalled();
    });

    it("開始情報はストアに残り、ブロックが消費すると消える（blockStart は成功で下りる）", async () => {
      await store.startFromBlock("blk1");
      expect(store.getState().pendingBlockWrites["r1"]).toEqual({
        recordingId: "r1",
        blockId: "blk1",
        start: { fileId: "f1", startedAt: "2026-10-19T00:00:00Z" },
      });
      expect(store.getState().blockStart).toBeNull();
      store.consumeBlockWrite("r1", "start");
      expect(store.getState().pendingBlockWrites["r1"]).toBeUndefined();
      await store.stop();
    });

    it("何も録れなかった停止は reset が残り、消費すると消える", async () => {
      vi.mocked(api.stopRecording).mockResolvedValue({ ...stopResult, fileId: null, tracks: { system: false, mic: false } });
      await store.startFromBlock("blk1");
      store.consumeBlockWrite("r1", "start");
      await store.stop();
      expect(store.getState().pendingBlockWrites["r1"]).toMatchObject({ reset: true });
      store.consumeBlockWrite("r1", "stop");
      expect(store.getState().pendingBlockWrites["r1"]).toBeUndefined();
    });

    it("ブロックが見えない間（別ノート）に始まり止まっても、残っていて戻ってから適用できる", async () => {
      vi.mocked(api.stopRecording).mockResolvedValue(stopResult);
      await store.startFromBlock("blk1");
      await store.stop();
      store.clearResult(); // Mount が先に結果を手放しても書き込みは残る
      // 別の録音が始まって止まっても、先の分は残る
      vi.mocked(api.startRecording).mockResolvedValueOnce({ id: "r2", fileId: "f2", startedAt: "y" });
      vi.mocked(api.stopRecording).mockResolvedValueOnce({ ...stopResult, id: "r2", fileId: "f2" });
      await store.start();
      await store.stop();
      const w = store.getState().pendingBlockWrites;
      expect(w["r1"]).toMatchObject({ blockId: "blk1", start: { fileId: "f1" }, durationMs: 5000 });
      expect(w["r2"]).toMatchObject({ durationMs: 5000 });
      store.consumeBlockWrite("r1", "start");
      store.consumeBlockWrite("r1", "stop");
      expect(store.getState().pendingBlockWrites["r1"]).toBeUndefined();
    });

    it("録音中は始められない（null）", async () => {
      await store.start();
      expect(await store.startFromBlock("blk2")).toBeNull();
      await store.stop();
    });
  });

  describe("文字起こしの状態（jobId ごと）", () => {
    const seg = (jobId: string, n: number, fileId = "s1") => ({
      jobId,
      fileId,
      track: "system" as const,
      segments: Array.from({ length: n }, (_, k) => ({ startMs: k, endMs: k + 1, text: "x", noSpeechProb: 0.1 })),
    });
    const job = (id: string) => store.getState().transcribes[id];

    async function startWithJob() {
      vi.mocked(api.startRecording).mockResolvedValue({ id: "r1", fileId: "f1", startedAt: "x", transcribeJobId: "j1" });
      await store.openConfirm();
      await store.start();
      await store.attachListeners();
    }

    it("設定が録音開始に渡り、live の jobId が状態に入る", async () => {
      await startWithJob();
      expect(api.startRecording).toHaveBeenCalledWith({ captureSystem: true, liveTranscribe: true, language: "auto", modelSize: "large-v3-turbo" });
      expect(store.getState().liveJobId).toBe("j1");
      expect(job("j1")).toMatchObject({ status: "running", segmentCount: 0 });
    });

    it("transcribeJobId が null なら録音だけ", async () => {
      vi.mocked(api.startRecording).mockResolvedValue({ id: "r1", fileId: "f1", startedAt: "x", transcribeJobId: null });
      await store.start();
      expect(store.getState().transcribes).toEqual({});
      expect(store.getState().liveJobId).toBeNull();
    });

    it("開始で startInfo が立ち、segment は fileId ごとに時刻順でたまる", async () => {
      await startWithJob();
      expect(store.getState().startInfo).toEqual({ id: "r1", fileId: "f1", startedAt: "x", captureSystem: true });
      handlers.tsegment({ ...seg("j1", 1, "f1"), track: "mic" as const, segments: [{ startMs: 9000, endMs: 9500, text: "b", noSpeechProb: 0 }] });
      handlers.tsegment({ ...seg("j1", 1, "f1"), segments: [{ startMs: 1000, endMs: 1500, text: "a", noSpeechProb: 0 }] });
      expect(store.getState().liveSegments["f1"]).toEqual([
        { track: "system", startMs: 1000, endMs: 1500, text: "a" },
        { track: "mic", startMs: 9000, endMs: 9500, text: "b" },
      ]);
    });

    it("ジョブが失敗で終わると fileId ごとに記録され、新しいジョブの開始で live と一緒に消える", async () => {
      await startWithJob();
      handlers.tsegment(seg("j1", 1, "f1"));
      handlers.terror({ jobId: "j1", message: "boom" });
      expect(store.getState().lastJobByFile["f1"]).toBe("failed");
      expect(store.getState().liveSegments["f1"]).toHaveLength(1);
      vi.mocked(api.startTranscribe).mockResolvedValue({ jobId: "j2" });
      await store.startTranscribeFor(["f1"]);
      expect(store.getState().lastJobByFile["f1"]).toBeUndefined();
      expect(store.getState().liveSegments["f1"]).toBeUndefined();
    });

    it("segment は加算、progress は ratio を更新する", async () => {
      await startWithJob();
      handlers.tsegment(seg("j1", 2));
      handlers.tsegment(seg("j1", 3));
      handlers.tprogress({ jobId: "j1", fileId: "s1", ratio: 0.4 });
      expect(job("j1")).toMatchObject({ segmentCount: 5, ratio: 0.4, status: "running", fileIds: ["s1"] });
    });

    it("別 jobId のイベントは別ジョブに入り、互いに干渉しない", async () => {
      await startWithJob();
      handlers.tsegment(seg("other", 4));
      handlers.tdone({ jobId: "other", fileIds: ["z"] });
      expect(job("j1")).toMatchObject({ segmentCount: 0, status: "running" });
      expect(job("other")).toBeUndefined();
    });

    it("done / error / cancelled は最初の終端だけを採用する", async () => {
      await startWithJob();
      handlers.tdone({ jobId: "j1", fileIds: ["s1"] });
      handlers.terror({ jobId: "j1", message: "late" });
      handlers.tcancel({ jobId: "j1" });
      expect(job("j1")).toMatchObject({ status: "done", ratio: 1 });
      store.clearTranscribe("j1");
      expect(job("j1")).toBeUndefined();
    });

    it("error が先なら failed のまま done に上書きされない", async () => {
      await startWithJob();
      handlers.terror({ jobId: "j1", message: "boom" });
      handlers.tdone({ jobId: "j1", fileIds: ["s1"] });
      expect(job("j1")).toMatchObject({ status: "failed", message: "boom" });
    });

    it("start 応答より前に届いた segment を adopt 時に反映する", async () => {
      await store.attachListeners();
      handlers.tsegment(seg("j1", 3));
      await startWithJob();
      expect(job("j1")).toMatchObject({ status: "running", segmentCount: 3 });
    });

    it("adopt 時にすでに終端が届いていれば running にしない", async () => {
      await store.attachListeners();
      handlers.tsegment(seg("j1", 1));
      handlers.tdone({ jobId: "j1", fileIds: ["s1"] });
      handlers.terror({ jobId: "j1", message: "late" });
      await startWithJob();
      expect(job("j1")).toMatchObject({ status: "done" });
    });

    it("終端のあとにクリアしたジョブは再 adopt されても戻らない", async () => {
      await startWithJob();
      handlers.tdone({ jobId: "j1", fileIds: ["s1"] });
      store.clearTranscribe("j1");
      vi.mocked(api.stopRecording).mockResolvedValue({ ...stopResult, transcribeJobId: "j1" });
      await store.stop();
      expect(job("j1")).toBeUndefined();
    });

    it("停止結果の transcribeJobId を引き継ぐ（開始時に無かった場合）", async () => {
      await store.openConfirm();
      await store.start();
      vi.mocked(api.stopRecording).mockResolvedValue({ ...stopResult, transcribeJobId: "j9" });
      await store.stop();
      expect(job("j9")).toMatchObject({ status: "running", fileIds: ["f1"] });
      expect(store.getState().liveJobId).toBe("j9");
    });

    it("トーストの文言: done は保存、fileIds 空の done と cancelled は出さない、failed は失敗", () => {
      const base = { jobId: "j", ratio: 1, segmentCount: 0 };
      expect(store.transcribeToastKey({ ...base, status: "done", fileIds: ["a"] })).toBe("meeting.transcribeSaved");
      expect(store.transcribeToastKey({ ...base, status: "done", fileIds: [] })).toBeNull();
      expect(store.transcribeToastKey({ ...base, status: "cancelled", fileIds: [] })).toBeNull();
      expect(store.transcribeToastKey({ ...base, status: "failed", fileIds: [] })).toBe("meeting.transcribeFailed");
    });

    it("cancelled イベントでジョブは cancelled になる", async () => {
      await startWithJob();
      handlers.tcancel({ jobId: "j1" });
      expect(job("j1")?.status).toBe("cancelled");
    });
  });
});
