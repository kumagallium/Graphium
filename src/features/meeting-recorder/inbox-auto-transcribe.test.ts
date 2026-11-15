import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("../settings/store", () => ({ getMeetingSettings: () => ({ modelSize: "large-v3-turbo" }) }));
vi.mock("./api", () => ({ readTranscript: vi.fn() }));
vi.mock("./model-auto-download", () => ({
  bytesToMb: (b: number) => Math.round(b / 1_000_000),
  downloadPercent: (s: { received: number; total: number }) => (s.total > 0 ? Math.floor((s.received / s.total) * 100) : 0),
  ensureTranscribeModel: vi.fn(),
  getModelDownloadState: vi.fn(),
  subscribeModelDownload: vi.fn(),
}));
vi.mock("./transcribe-external", () => ({
  startExternalTranscribe: vi.fn(),
  waitExternalTranscribeFinished: vi.fn(),
}));

import * as api from "./api";
import { enqueueInboxTranscribe, type InboxTranscribeReporter, whenInboxTranscribeIdleForTest } from "./inbox-auto-transcribe";
import { ensureTranscribeModel, getModelDownloadState, subscribeModelDownload } from "./model-auto-download";
import { startExternalTranscribe, waitExternalTranscribeFinished } from "./transcribe-external";

const start = vi.mocked(startExternalTranscribe);
const wait = vi.mocked(waitExternalTranscribeFinished);
const ensure = vi.mocked(ensureTranscribeModel);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.readTranscript).mockResolvedValue(null as never);
  ensure.mockResolvedValue(true);
  vi.mocked(subscribeModelDownload).mockReturnValue(() => {});
  vi.mocked(getModelDownloadState).mockReturnValue({ status: "idle", received: 0, total: 0, expectedBytes: 0 });
  wait.mockResolvedValue("finished");
});

async function run(ids: string[], reporter: InboxTranscribeReporter = {}) {
  start.mockImplementation((id) => impl(id));
  enqueueInboxTranscribe(ids, reporter);
  await whenInboxTranscribeIdleForTest();
}
let impl: (id: string) => ReturnType<typeof startExternalTranscribe> = async () => ({ result: "started", jobId: "j", seconds: 10 });

describe("enqueueInboxTranscribe", () => {
  beforeEach(() => {
    impl = async () => ({ result: "started", jobId: "j", seconds: 10 });
  });

  it("音声を 1 本ずつ順に処理し、各ジョブの終わりを待ってから次へ進む", async () => {
    const order: string[] = [];
    impl = async (id) => {
      order.push(`start:${id}`);
      return { result: "started", jobId: `job-${id}`, seconds: 5 };
    };
    wait.mockImplementation(async (o) => {
      order.push(`wait:${o.jobId}`);
      return "finished";
    });
    await run(["a", "b"]);
    expect(order).toEqual(["start:a", "wait:job-a", "start:b", "wait:job-b"]);
  });

  it("保存済みの文字起こしがある音声は何もしない", async () => {
    vi.mocked(api.readTranscript).mockImplementation(async (id: string) => (id === "a" ? ({ segments: [] } as never) : (null as never)));
    await run(["a", "b"]);
    expect(start.mock.calls.map((c) => c[0])).toEqual(["b"]);
  });

  it("1 本が時間切れ・例外・失敗でも、必ず次へ進む", async () => {
    const seen: string[] = [];
    impl = async (id) => {
      seen.push(id);
      if (id === "boom") throw new Error("x");
      if (id === "bad") return { result: "unreadable" };
      return { result: "started", jobId: `job-${id}`, seconds: 1 };
    };
    wait.mockImplementation(async (o) => (o.jobId === "job-slow" ? "timeout" : "finished"));
    const skipped = vi.fn();
    await run(["slow", "boom", "bad", "last"], { skipped });
    expect(seen).toEqual(["slow", "boom", "bad", "last"]);
    // 例外と読めなかったを failed にまとめて 1 回だけ知らせる（時間切れは数えない）
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith({ failed: 2, tooLong: 0, noModel: 0 });
  });

  it("長すぎるが混ざっても 1 回の知らせにまとめる", async () => {
    impl = async (id) => (id.startsWith("long") ? { result: "too-long" } : { result: "unreadable" });
    const skipped = vi.fn();
    await run(["long", "x", "long2"], { skipped });
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith({ failed: 1, tooLong: 2, noModel: 0 });
  });

  it("すでに別の処理が進めている音声（busy）は数えず待たない", async () => {
    impl = async () => ({ result: "busy" });
    const skipped = vi.fn();
    await run(["a"], { skipped });
    expect(wait).not.toHaveBeenCalled();
    expect(skipped).not.toHaveBeenCalled();
  });

  it("モデルが使えなければ残りを諦めて 1 回だけ知らせる（音声は触らない）。取得は自動（auto）で頼む", async () => {
    ensure.mockResolvedValue(false);
    const skipped = vi.fn();
    await run(["a", "b", "c"], { skipped });
    expect(ensure).toHaveBeenCalledWith("large-v3-turbo", { auto: true });
    expect(start.mock.calls).toHaveLength(0);
    expect(skipped).toHaveBeenCalledWith({ failed: 0, tooLong: 0, noModel: 3 });
  });

  it("取得している間は、進み具合（変わったときだけ）と終わりを知らせる", async () => {
    let cb: () => void = () => {};
    vi.mocked(subscribeModelDownload).mockImplementation((c) => {
      cb = c;
      return () => {};
    });
    ensure.mockImplementation(async () => {
      for (const received of [0, 100, 150, 500]) {
        vi.mocked(getModelDownloadState).mockReturnValue({ status: "downloading", received, total: 1000, expectedBytes: 574_000_000 });
        cb();
      }
      vi.mocked(getModelDownloadState).mockReturnValue({ status: "idle", received: 0, total: 0, expectedBytes: 574_000_000 });
      return true;
    });
    const modelDownloading = vi.fn();
    const modelDownloadEnded = vi.fn();
    await run(["a"], { modelDownloading, modelDownloadEnded });
    expect(modelDownloading.mock.calls.map((c) => c[0].percent)).toEqual([0, 10, 15, 50]);
    expect(modelDownloading.mock.calls[0][0].mb).toBe(574);
    expect(modelDownloadEnded).toHaveBeenCalledWith(true);
  });

  it("取得済みなら取得の知らせは出ない", async () => {
    const modelDownloading = vi.fn();
    const modelDownloadEnded = vi.fn();
    await run(["a"], { modelDownloading, modelDownloadEnded });
    expect(modelDownloading).not.toHaveBeenCalled();
    expect(modelDownloadEnded).not.toHaveBeenCalled();
  });

  it("知らせのコールバックが例外を投げても処理は止まらない", async () => {
    impl = async () => ({ result: "unreadable" });
    const skipped = vi.fn(() => {
      throw new Error("ui");
    });
    await run(["a", "b"], { skipped });
    expect(start.mock.calls).toHaveLength(2);
  });
});
