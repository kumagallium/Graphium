import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  transcribeInputBegin: vi.fn(),
  transcribeInputAppend: vi.fn(),
  transcribeInputFinish: vi.fn(),
  transcribeInputDiscard: vi.fn(),
  mediaFileSize: vi.fn(),
}));
vi.mock("./store", () => ({ startTranscribeJob: vi.fn(), waitTranscribeJob: vi.fn() }));
vi.mock("./audio-convert", async (orig) => ({
  ...(await orig<typeof import("./audio-convert")>()),
  convertToPcm16k: vi.fn(),
}));
const provider = {
  readMediaBytes: vi.fn(),
  getMediaBlobUrl: vi.fn(),
};
vi.mock("../../lib/storage/registry", () => ({ getActiveProvider: () => provider }));

import * as api from "./api";
import { AudioConvertError, MAX_SOURCE_BYTES, convertToPcm16k } from "./audio-convert";
import { startTranscribeJob, waitTranscribeJob } from "./store";
import {
  isExternalConverting,
  startExternalTranscribe,
  transcribeWaitLimitMs,
  waitExternalTranscribeFinished,
} from "./transcribe-external";

const a = vi.mocked(api);

beforeEach(() => {
  vi.resetAllMocks();
  provider.readMediaBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(convertToPcm16k).mockResolvedValue({ pcm: new Uint8Array(4), seconds: 90 });
  a.transcribeInputBegin.mockResolvedValue(undefined);
  a.transcribeInputAppend.mockResolvedValue(undefined);
  a.transcribeInputFinish.mockResolvedValue(undefined);
  a.transcribeInputDiscard.mockResolvedValue(undefined);
  a.mediaFileSize.mockResolvedValue(1000);
  vi.mocked(startTranscribeJob).mockResolvedValue("job1");
});

describe("startExternalTranscribe", () => {
  it("大きさが上限超えなら、実体を読まずに too-large", async () => {
    a.mediaFileSize.mockResolvedValue(MAX_SOURCE_BYTES + 1);
    expect(await startExternalTranscribe("big")).toEqual({ result: "too-large" });
    expect(provider.readMediaBytes).not.toHaveBeenCalled();
    expect(provider.getMediaBlobUrl).not.toHaveBeenCalled();
    expect(a.transcribeInputBegin).not.toHaveBeenCalled();
  });

  it("大きさが取れないとき（失敗・null）は今までどおり読む", async () => {
    a.mediaFileSize.mockRejectedValue(new Error("unsupported"));
    expect(await startExternalTranscribe("f1")).toMatchObject({ result: "started" });
    expect(provider.readMediaBytes).toHaveBeenCalledWith("f1");
    a.mediaFileSize.mockResolvedValue(null);
    expect(await startExternalTranscribe("f2")).toMatchObject({ result: "started" });
    expect(provider.readMediaBytes).toHaveBeenCalledWith("f2");
  });

  it("読む → 変換 → 渡す → ジョブ開始。jobId と音声の長さを返す。表示用の URL は作らない", async () => {
    expect(await startExternalTranscribe("f1")).toEqual({ result: "started", jobId: "job1", seconds: 90 });
    expect(provider.readMediaBytes).toHaveBeenCalledWith("f1");
    expect(provider.getMediaBlobUrl).not.toHaveBeenCalled();
    expect(a.transcribeInputBegin).toHaveBeenCalledWith("f1");
    expect(a.transcribeInputFinish).toHaveBeenCalledWith("f1");
    expect(a.transcribeInputDiscard).not.toHaveBeenCalled();
    expect(isExternalConverting("f1")).toBe(false);
  });

  it("同じ fileId の変換中に重ねて呼ぶと busy（共有の状態）。終われば戻る", async () => {
    let release: (v: { pcm: Uint8Array; seconds: number }) => void = () => {};
    vi.mocked(convertToPcm16k).mockReturnValue(new Promise((r) => (release = r)));
    const first = startExternalTranscribe("f1");
    await vi.waitFor(() => expect(isExternalConverting("f1")).toBe(true));
    expect(await startExternalTranscribe("f1")).toEqual({ result: "busy" });
    expect(a.transcribeInputBegin).not.toHaveBeenCalled();
    release({ pcm: new Uint8Array(2), seconds: 1 });
    expect((await first).result).toBe("started");
    expect(isExternalConverting("f1")).toBe(false);
  });

  it("Rust の begin が busy を返したら busy（discard しない = 進んでいる側の一時ファイルを消さない）", async () => {
    a.transcribeInputBegin.mockRejectedValue("busy");
    expect(await startExternalTranscribe("f1")).toEqual({ result: "busy" });
    expect(a.transcribeInputDiscard).not.toHaveBeenCalled();
  });

  it("形式を読めない・長すぎるは理由つきで返す", async () => {
    vi.mocked(convertToPcm16k).mockRejectedValueOnce(new AudioConvertError("unreadable"));
    expect(await startExternalTranscribe("f1")).toEqual({ result: "unreadable" });
    vi.mocked(convertToPcm16k).mockRejectedValueOnce(new AudioConvertError("too-long"));
    expect(await startExternalTranscribe("f1")).toEqual({ result: "too-long" });
    vi.mocked(convertToPcm16k).mockRejectedValueOnce(new AudioConvertError("too-large"));
    expect(await startExternalTranscribe("f1")).toEqual({ result: "too-large" });
    a.transcribeInputAppend.mockRejectedValueOnce("audio too long");
    expect(await startExternalTranscribe("f1")).toEqual({ result: "too-long" });
    expect(a.transcribeInputDiscard).toHaveBeenCalledWith("f1"); // 渡し始めていたので片付ける
  });

  it("受け渡しの途中で失敗したら discard して failed", async () => {
    a.transcribeInputFinish.mockRejectedValue("io error");
    expect(await startExternalTranscribe("f1")).toEqual({ result: "failed" });
    expect(a.transcribeInputDiscard).toHaveBeenCalledWith("f1");
  });

  it("ジョブを始められなければ discard して failed（待たせない）", async () => {
    vi.mocked(startTranscribeJob).mockResolvedValue(null);
    expect(await startExternalTranscribe("f1")).toEqual({ result: "failed" });
    expect(a.transcribeInputDiscard).toHaveBeenCalledWith("f1");
  });

  it("readMediaBytes が無いプロバイダでは URL から読み、その URL は revoke しない（共有のキャッシュ）", async () => {
    provider.readMediaBytes.mockResolvedValue(undefined);
    provider.getMediaBlobUrl.mockResolvedValue("blob:shared");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    vi.stubGlobal("fetch", vi.fn(async () => ({ blob: async () => new Blob(["x"]) })));
    expect((await startExternalTranscribe("f1")).result).toBe("started");
    expect(revoke).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("終わりの待ち", () => {
  it("上限は音声の長さの 2 倍 + 10 分", () => {
    expect(transcribeWaitLimitMs(0)).toBe(600_000);
    expect(transcribeWaitLimitMs(3600)).toBe((7200 + 600) * 1000);
  });

  it("始めたジョブ（jobId）を、その長さに見合う上限つきで待つ", async () => {
    vi.mocked(waitTranscribeJob).mockResolvedValue("timeout");
    expect(await waitExternalTranscribeFinished({ jobId: "job1", seconds: 60 })).toBe("timeout");
    expect(waitTranscribeJob).toHaveBeenCalledWith("job1", transcribeWaitLimitMs(60));
  });
});
