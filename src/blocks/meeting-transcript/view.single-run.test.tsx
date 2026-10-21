// @vitest-environment jsdom
// 清書・要約の二重実行の回帰ガード
//
// 清書の実行中にノートを開き直す（ブロックが描き直される）と、新しい画面からもう一度
// 「清書する」を押せて、同じ録音の清書が 2 本同時に AI へ送られていた。ローカルの LLM
// （LM Studio など）では 2 本が同じ文脈の枠を取り合い、両方とも失敗する。
// 録音ごとに実行中を 1 か所で覚え、開き直した画面にも進み具合を出す。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/platform", async (orig) => ({
  ...(await orig<typeof import("../../lib/platform")>()),
  isTauri: () => true,
}));

const transcript = JSON.stringify({
  segments: [
    { track: "system", startMs: 0, endMs: 2000, text: "はじめます" },
    { track: "mic", startMs: 3000, endMs: 5000, text: "よろしくお願いします" },
  ],
});
const invokeMock = vi.fn(async (cmd: string, _args?: unknown) => {
  if (cmd === "read_media_transcript") return transcript;
  if (cmd === "read_media_sidecar") return null;
  return undefined;
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args) }));

vi.mock("../../features/ai-assistant/store", async (orig) => ({
  ...(await orig<typeof import("../../features/ai-assistant/store")>()),
  useOptionalAiAvailable: () => true,
}));

// 清書は終わらせずに止めておく（実行中にブロックを描き直す）
let finishCleanup: ((v: unknown) => void) | null = null;
const cleanupMock = vi.fn(
  (params: { onProgress?: (d: number, t: number) => void }) =>
    new Promise((resolve) => {
      params.onProgress?.(0, 3);
      finishCleanup = resolve;
    }),
);
vi.mock("../../features/meeting-recorder/cleanup-service", async (orig) => ({
  ...(await orig<typeof import("../../features/meeting-recorder/cleanup-service")>()),
  cleanupMeeting: (p: never) => cleanupMock(p),
}));

import { syncLocale, t } from "../../i18n";
import { MeetingTranscriptView } from "./view";
import { __resetRunsForTest } from "./runs";

const block = {
  id: "mt-1",
  type: "meetingTranscript",
  props: {
    recordingId: "rec-1",
    fileId: "file-1",
    startedAt: "2026-10-21T14:00:00+09:00",
    durationMs: 5000,
    collapsed: false,
    expanded: false,
    showAll: false,
    expandedBlockIds: "",
    summaryBlockIds: "",
    summaryHash: "",
    writtenBlockIds: "",
    maskSensitive: false,
  },
};
const editor = {
  isEditable: true,
  document: [block],
  getBlock: (id: string) => (id === block.id ? block : undefined),
  updateBlock: vi.fn(),
};

async function mountAndOpenCleanupTab() {
  const view = render(<MeetingTranscriptView block={block} editor={editor} />);
  // 文字起こしを読み終えるまで待つ
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.click(await screen.findByRole("tab", { name: t("meetingBlock.tabCleanup") }));
  return view;
}

describe("清書の二重実行", () => {
  beforeEach(() => {
    syncLocale("ja");
    cleanupMock.mockClear();
    finishCleanup = null;
    __resetRunsForTest();
  });
  afterEach(() => {
    finishCleanup?.({ paragraphs: [], fixes: [], model: "m", masked: false });
    cleanup();
  });

  it("実行中に描き直したブロックからは、同じ録音の清書をもう一度送らない", async () => {
    const first = await mountAndOpenCleanupTab();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.cleanupRun") }));
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    // ノートを開き直す（ブロックが外れて、もう一度描かれる）
    first.unmount();
    await mountAndOpenCleanupTab();

    // 開き直した画面で押せても（押せないのが正しい）、2 本目は送らない
    const again = screen.queryByRole("button", { name: t("meetingBlock.cleanupRun") });
    if (again) fireEvent.click(again);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    // 開き直した画面にも進み具合が出て、もう一度は押せない
    expect(again).toBeNull();
    expect(screen.getAllByRole("status").map((e) => e.textContent).join("\n")).toContain(
      t("meetingBlock.cleanupRunning", { done: "0", total: "3" }),
    );
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("実行中に開き直した画面にも、終わった清書が届く", async () => {
    const first = await mountAndOpenCleanupTab();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.cleanupRun") }));
    first.unmount();
    await mountAndOpenCleanupTab();

    await act(async () => {
      finishCleanup?.({ paragraphs: [{ text: "はじめます。", sources: ["s1"] }], fixes: [], model: "m", masked: false });
      finishCleanup = null;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText(/はじめます。/)).toBeTruthy();
    // 清書を保存した（素材のそばの cleanup.json）
    expect(invokeMock).toHaveBeenCalledWith("save_media_sidecar", expect.objectContaining({ fileId: "file-1", kind: "cleanup" }));
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });
});
