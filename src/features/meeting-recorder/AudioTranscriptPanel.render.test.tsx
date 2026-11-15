// @vitest-environment jsdom
// 音声のプレビュー下の文字起こし欄: 取得中の文・失敗の文・処理中の表示

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";

const dl = {
  state: { status: "idle", received: 0, total: 0, expectedBytes: 574_000_000 } as {
    status: "idle" | "downloading" | "failed";
    received: number;
    total: number;
    expectedBytes: number;
  },
  listeners: new Set<() => void>(),
};
const setDl = (patch: Partial<typeof dl.state>) => {
  dl.state = { ...dl.state, ...patch };
  dl.listeners.forEach((l) => l());
};

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({ extractFileId: () => "f1", loadMediaText: async () => null }),
}));
vi.mock("../settings/store", () => ({ getMeetingSettings: () => ({ modelSize: "large-v3-turbo" }) }));
vi.mock("./api", () => ({ getModelStatus: vi.fn(), readTranscript: vi.fn(async () => null) }));
vi.mock("./store", () => ({
  subscribe: () => () => {},
  getState: () => ({ transcribes: {} }),
  startTranscribeFor: vi.fn(async () => true),
}));
vi.mock("./use-meeting-recorder", () => ({ useMeetingRecorder: () => ({ transcribes: {} }) }));
vi.mock("./transcribe-external", () => ({
  startExternalTranscribe: vi.fn(),
  useExternalConverting: vi.fn(() => false),
}));
vi.mock("./model-auto-download", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    bytesToMb: (b: number) => Math.round(b / 1_000_000),
    downloadPercent: (s: { received: number; total: number }) => (s.total > 0 ? Math.floor((s.received / s.total) * 100) : 0),
    ensureTranscribeModel: vi.fn(),
    useModelDownloadState: () =>
      useSyncExternalStore(
        (cb) => {
          dl.listeners.add(cb);
          return () => dl.listeners.delete(cb);
        },
        () => dl.state,
      ),
  };
});

import * as api from "./api";
import { AudioTranscriptPanel } from "./AudioTranscriptPanel";
import { ensureTranscribeModel } from "./model-auto-download";
import { startExternalTranscribe, useExternalConverting } from "./transcribe-external";

const renderPanel = () =>
  render(
    <LocaleProvider>
      <AudioTranscriptPanel url="media://f1" name="voice.m4a" mimeType="audio/mp4" />
    </LocaleProvider>,
  );
const sizeText = (key: string) => t(key, { size: "574", percent: "12" });

beforeEach(() => {
  vi.clearAllMocks();
  dl.state = { status: "idle", received: 0, total: 0, expectedBytes: 574_000_000 };
  vi.mocked(useExternalConverting).mockReturnValue(false);
});
afterEach(cleanup);

describe("AudioTranscriptPanel の取得中の文", () => {
  it("ほかの理由（受信箱・録音の開始など）で取得中なら「取得しています」までにとどめる（始めますとは言わない）", async () => {
    renderPanel();
    act(() => setDl({ status: "downloading", received: 120, total: 1000 }));
    const text = await screen.findByText(/574 MB/);
    expect(text.textContent).toBe(sizeText("meeting.transcriptModelDownloading"));
    expect(text.textContent).not.toBe(sizeText("meeting.transcriptModelDownloadingThenStart"));
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("このパネルのボタンが取得を待っているときだけ「終わったら始めます」と言う", async () => {
    let finish: (ok: boolean) => void = () => {};
    vi.mocked(api.getModelStatus).mockResolvedValue([{ size: "large-v3-turbo", present: false, bytes: 0, expectedBytes: 574_000_000 }]);
    vi.mocked(ensureTranscribeModel).mockImplementation(() => {
      setDl({ status: "downloading", received: 120, total: 1000 });
      return new Promise<boolean>((r) => (finish = r));
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    const text = await screen.findByText(/574 MB/);
    expect(text.textContent).toBe(sizeText("meeting.transcriptModelDownloadingThenStart"));
    
    await act(async () => {
      setDl({ status: "idle" });
      finish(false);
    });
    // 取得できなかったら、設定からの取得を案内する（始めますの文は消える）
    await waitFor(() => expect(screen.queryByText(/574 MB/)).toBeNull());
    expect(screen.getByText(t("meeting.transcriptModelMissing"))).toBeTruthy();
  });
});

describe("AudioTranscriptPanel の結果の文と処理中", () => {
  const present = () =>
    vi.mocked(api.getModelStatus).mockResolvedValue([{ size: "large-v3-turbo", present: true, bytes: 1, expectedBytes: 574_000_000 }]);

  it("変換・受け渡しがうまくいかなかったとき（failed）も 1 文を出す", async () => {
    present();
    vi.mocked(startExternalTranscribe).mockResolvedValue({ result: "failed" });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(t("meeting.transcribeFailedPanel"))).toBeTruthy();
  });

  it("長すぎる・大きすぎる・読めないは、それぞれ別の文を出す（長さと大きさを取り違えない）", async () => {
    present();
    vi.mocked(startExternalTranscribe).mockResolvedValue({ result: "too-long" });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(t("meeting.transcribeTooLong"))).toBeTruthy();
    expect(t("meeting.transcribeTooLong")).toMatch(/2 (時間|hours)/);
    cleanup();
    vi.mocked(startExternalTranscribe).mockResolvedValue({ result: "too-large" });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(t("meeting.transcribeTooLarge"))).toBeTruthy();
    expect(t("meeting.transcribeTooLarge")).not.toMatch(/2 (時間|hours)/);
  });

  it("すでに別の処理が進んでいる（busy）ときは、黙って捨てずに「処理中」の文を出す", async () => {
    present();
    vi.mocked(startExternalTranscribe).mockResolvedValue({ result: "busy" });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(t("meeting.transcribeBusyNotice"))).toBeTruthy();
  });

  it("素材の MIME 型を文字起こしの開始に渡す", async () => {
    present();
    vi.mocked(startExternalTranscribe).mockResolvedValue({ result: "failed" });
    renderPanel();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(startExternalTranscribe).toHaveBeenCalledWith("f1", "audio/mp4"));
  });

  it("受信箱の自動処理が変換中のあいだも「処理中」で押せない（共有の状態）", () => {
    vi.mocked(useExternalConverting).mockReturnValue(true);
    renderPanel();
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe(t("meeting.transcribeRunning"));
  });
});
