import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  getModelStatus: vi.fn(),
  downloadModel: vi.fn(),
  onModelProgress: vi.fn(),
  onModelDone: vi.fn(),
  onModelCancelled: vi.fn(),
  onModelError: vi.fn(),
}));
// 取り消し・削除の印は設定の保存先（localStorage）の代わりにメモリで持つ
const declined = new Set<string>();
vi.mock("../settings/store", () => ({
  getMeetingSettings: () => ({ modelSize: "large-v3-turbo" }),
  isMeetingModelAutoDownloadDeclined: (size: string) => declined.has(size),
  setMeetingModelAutoDownloadDeclined: (size: string, on: boolean) => {
    if (on) declined.add(size);
    else declined.delete(size);
  },
}));

import * as api from "./api";
import {
  acceptAutoDownload,
  bytesToMb,
  canAutoDownload,
  declineAutoDownload,
  downloadPercent,
  ensureTranscribeModel,
  EXTERNAL_IDLE_MS,
  EXTERNAL_POLL_MS,
  getModelDownloadState,
  resetModelAutoDownloadForTest,
} from "./model-auto-download";

const m = vi.mocked(api);
const status = (present: boolean) => [
  { size: "large-v3-turbo" as const, present, bytes: present ? 574_041_195 : 0, expectedBytes: 574_041_195 },
];

beforeEach(() => {
  declined.clear();
  resetModelAutoDownloadForTest();
  vi.resetAllMocks();
  m.onModelProgress.mockResolvedValue(() => {});
  m.onModelDone.mockResolvedValue(() => {});
  m.onModelCancelled.mockResolvedValue(() => {});
  m.onModelError.mockResolvedValue(() => {});
});

describe("ensureTranscribeModel", () => {
  it("取得済みなら取得を始めない", async () => {
    m.getModelStatus.mockResolvedValue(status(true));
    expect(await ensureTranscribeModel()).toBe(true);
    expect(m.downloadModel).not.toHaveBeenCalled();
  });

  it("未取得なら取得を始め、完了で true を返す", async () => {
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValueOnce(status(true));
    m.downloadModel.mockResolvedValue(undefined);
    expect(await ensureTranscribeModel()).toBe(true);
    expect(m.downloadModel).toHaveBeenCalledWith("large-v3-turbo");
    expect(getModelDownloadState("large-v3-turbo").status).toBe("idle");
  });

  it("取得中に重ねて呼んでも取得は 1 本だけ", async () => {
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValue(status(true));
    let release: () => void = () => {};
    m.downloadModel.mockReturnValue(new Promise<void>((r) => (release = r)));
    const a = ensureTranscribeModel();
    const b = ensureTranscribeModel();
    await vi.waitFor(() => expect(m.downloadModel).toHaveBeenCalledTimes(1));
    expect(getModelDownloadState("large-v3-turbo").status).toBe("downloading");
    release();
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
  });

  it("進み具合を購読できる", async () => {
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValue(status(true));
    let onProgress: (e: { size: "large-v3-turbo"; received: number; total: number }) => void = () => {};
    m.onModelProgress.mockImplementation(async (cb) => {
      onProgress = cb as typeof onProgress;
      return () => {};
    });
    let release: () => void = () => {};
    m.downloadModel.mockReturnValue(new Promise<void>((r) => (release = r)));
    const p = ensureTranscribeModel();
    await vi.waitFor(() => expect(m.onModelProgress).toHaveBeenCalled());
    onProgress({ size: "large-v3-turbo", received: 287_020_598, total: 574_041_195 });
    expect(downloadPercent(getModelDownloadState("large-v3-turbo"))).toBe(50);
    release();
    await p;
  });

  it("失敗したら false を返し、理由を残す", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockRejectedValue("network error");
    expect(await ensureTranscribeModel()).toBe(false);
    const s = getModelDownloadState("large-v3-turbo");
    expect(s.status).toBe("failed");
    expect(s.error).toContain("network error");
  });

  it("取り消されたら（揃っていないので）false を返し、失敗にはしない", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockResolvedValue(undefined);
    expect(await ensureTranscribeModel()).toBe(false);
    expect(getModelDownloadState("large-v3-turbo").status).toBe("idle");
  });

  it("別の場所で取得中（already downloading）なら完了イベントを待つ", async () => {
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValueOnce(status(false)).mockResolvedValue(status(true));
    m.downloadModel.mockRejectedValue("already downloading");
    let onDone: (e: { size: "large-v3-turbo" }) => void = () => {};
    m.onModelDone.mockImplementation(async (cb) => {
      onDone = cb as typeof onDone;
      return () => {};
    });
    const p = ensureTranscribeModel();
    await vi.waitFor(() => expect(m.onModelDone).toHaveBeenCalled());
    onDone({ size: "large-v3-turbo" });
    expect(await p).toBe(true);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
  });
});

describe("自動の取得（auto）", () => {
  const SIZE = "large-v3-turbo" as const;

  it("取得済みなら auto でも true（取得しない）", async () => {
    m.getModelStatus.mockResolvedValue(status(true));
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(true);
    expect(m.downloadModel).not.toHaveBeenCalled();
  });

  it("自動の取得は 1 回の起動につき 1 回だけ試す（失敗しても同じ起動中に繰り返さない）", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockRejectedValue("network error");
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(false);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
    expect(canAutoDownload(SIZE)).toBe(false);
    // 2 回目の自動は取得を始めない（失敗の状態も変えない）
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(false);
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(false);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
  });

  it("利用者が取り消した・削除した印があれば、自動では取得しない", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    declineAutoDownload(SIZE);
    expect(canAutoDownload(SIZE)).toBe(false);
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(false);
    expect(m.downloadModel).not.toHaveBeenCalled();
    expect(getModelDownloadState(SIZE).status).toBe("idle");
  });

  it("利用者が自分で押した操作は取得し、取り消しの印も消える", async () => {
    declineAutoDownload(SIZE);
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValue(status(true));
    m.downloadModel.mockResolvedValue(undefined);
    expect(await ensureTranscribeModel(SIZE)).toBe(true);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
    expect(declined.has(SIZE)).toBe(false);
  });

  it("設定の「取得」（acceptAutoDownload）でも印が消える", () => {
    declineAutoDownload(SIZE);
    acceptAutoDownload(SIZE);
    expect(canAutoDownload(SIZE)).toBe(true);
  });

  it("自動で失敗した後でも、利用者が押せば取得する", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockRejectedValueOnce("network error");
    expect(await ensureTranscribeModel(SIZE, { auto: true })).toBe(false);
    m.getModelStatus.mockResolvedValueOnce(status(false)).mockResolvedValue(status(true));
    m.downloadModel.mockResolvedValue(undefined);
    expect(await ensureTranscribeModel(SIZE)).toBe(true);
    expect(m.downloadModel).toHaveBeenCalledTimes(2);
  });
});

describe("別の場所の取得を待つ（読み直しと時間切れ）", () => {
  const SIZE = "large-v3-turbo" as const;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("完了イベントを取り逃しても、数秒おきの読み直しで揃ったことが分かって解ける", async () => {
    let present = false;
    m.getModelStatus.mockImplementation(async () => status(present));
    m.downloadModel.mockRejectedValue("already downloading");
    const p = ensureTranscribeModel(SIZE);
    await vi.advanceTimersByTimeAsync(EXTERNAL_POLL_MS * 2);
    present = true;
    await vi.advanceTimersByTimeAsync(EXTERNAL_POLL_MS);
    expect(await p).toBe(true);
  });

  it("取り消しのイベントを取り逃して何も届かなくても、一定時間で待つのをやめる（取り消し扱い）", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockRejectedValue("already downloading");
    const p = ensureTranscribeModel(SIZE);
    await vi.advanceTimersByTimeAsync(EXTERNAL_IDLE_MS + EXTERNAL_POLL_MS * 2);
    expect(await p).toBe(false);
    expect(getModelDownloadState(SIZE).status).toBe("idle");
  });

  it("無通信で諦めた自動取得は「試した」に数えず、あとの自動取得でもう一度待てる", async () => {
    m.getModelStatus.mockResolvedValue(status(false));
    m.downloadModel.mockRejectedValue("already downloading");
    const p = ensureTranscribeModel(SIZE, { auto: true });
    await vi.advanceTimersByTimeAsync(EXTERNAL_IDLE_MS + EXTERNAL_POLL_MS * 2);
    expect(await p).toBe(false);
    expect(canAutoDownload(SIZE)).toBe(true);
    // もう一度の自動取得は、また取得（待ち）に入る
    m.downloadModel.mockClear();
    const p2 = ensureTranscribeModel(SIZE, { auto: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(m.downloadModel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(EXTERNAL_IDLE_MS + EXTERNAL_POLL_MS * 2);
    expect(await p2).toBe(false);
  });

  it("進み具合が届き続けている間は待つ", async () => {
    let onProgress: (e: { size: typeof SIZE; received: number; total: number }) => void = () => {};
    m.onModelProgress.mockImplementation(async (cb) => {
      onProgress = cb as typeof onProgress;
      return () => {};
    });
    let present = false;
    m.getModelStatus.mockImplementation(async () => status(present));
    m.downloadModel.mockRejectedValue("already downloading");
    const p = ensureTranscribeModel(SIZE);
    // 無通信の上限より長く経つが、その間も進み具合が届く
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(EXTERNAL_IDLE_MS / 2);
      onProgress({ size: SIZE, received: i, total: 100 });
    }
    expect(getModelDownloadState(SIZE).status).toBe("downloading");
    present = true;
    await vi.advanceTimersByTimeAsync(EXTERNAL_POLL_MS);
    expect(await p).toBe(true);
  });
});

describe("表示用の変換", () => {
  it("実サイズを MB に丸める", () => {
    expect(bytesToMb(574_041_195)).toBe(574);
    expect(bytesToMb(0)).toBe(1);
  });
});
