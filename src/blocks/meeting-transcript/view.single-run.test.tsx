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
// 清書のモデルの読み込み中のコンテキスト長（null = ローカルでない・確かめられない）
const contextMock = vi.fn(async (): Promise<number | null> => null);
vi.mock("../../features/meeting-recorder/cleanup-service", async (orig) => ({
  ...(await orig<typeof import("../../features/meeting-recorder/cleanup-service")>()),
  cleanupMeeting: (p: never) => cleanupMock(p),
  fetchMeetingModelContext: () => contextMock(),
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

/** 押したあとの非同期（コンテキスト長の問い合わせ）を進める */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
    contextMock.mockReset();
    contextMock.mockResolvedValue(null);
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
    await flush();
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    // ノートを開き直す（ブロックが外れて、もう一度描かれる）
    first.unmount();
    await mountAndOpenCleanupTab();

    // 開き直した画面で押せても（押せないのが正しい）、2 本目は送らない
    const again = screen.queryByRole("button", { name: t("meetingBlock.cleanupRun") });
    if (again) fireEvent.click(again);
    await flush();
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
    await flush();
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

describe("送る前のコンテキスト長の確認", () => {
  beforeEach(() => {
    syncLocale("ja");
    cleanupMock.mockClear();
    contextMock.mockReset();
    finishCleanup = null;
    __resetRunsForTest();
  });
  afterEach(() => {
    finishCleanup?.({ paragraphs: [], fixes: [], model: "m", masked: false });
    cleanup();
  });

  it("LM Studio の長さが足りなそうなら、確かめてから送る（このまま実行 / やめる）", async () => {
    contextMock.mockResolvedValue(2048);
    await mountAndOpenCleanupTab();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.cleanupRun") }));
    await flush();
    expect(cleanupMock).not.toHaveBeenCalled();
    expect(screen.getByText(/2,048 トークンで読み込まれています/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.contextCancel") }));
    expect(screen.queryByText(/2,048 トークンで読み込まれています/)).toBeNull();
    expect(cleanupMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.cleanupRun") }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.contextProceed") }));
    await flush();
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("足りていれば何も聞かずに送る", async () => {
    contextMock.mockResolvedValue(65536);
    await mountAndOpenCleanupTab();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.cleanupRun") }));
    await flush();
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });
});

describe("メモを取る", () => {
  beforeEach(() => {
    syncLocale("ja");
    __resetRunsForTest();
  });
  afterEach(async () => {
    const { setMeetingNoteActions } = await import("../../features/meeting-recorder/note-actions");
    setMeetingNoteActions(null);
    cleanup();
  });

  it("メモのノートを作り、ブロックの下に @ リンクを入れ、派生の線を足し、サイドピークで開く", async () => {
    const { setMeetingNoteActions } = await import("../../features/meeting-recorder/note-actions");
    const created: string[] = [];
    const opened: string[] = [];
    const derived: Array<[string, string]> = [];
    const ed = {
      ...editor,
      insertBlocks: vi.fn(() => [{ id: "link-1" }]),
      updateBlock: vi.fn(),
    };
    setMeetingNoteActions({
      isMainEditor: (e) => e === ed,
      createLinkedNote: async (title) => {
        created.push(title);
        return "memo-1";
      },
      openInSidePeek: (id) => opened.push(id),
      linkDerived: (id, from) => derived.push([id, from]),
      loadNoteText: async () => null,
    });
    render(<MeetingTranscriptView block={block} editor={ed} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: t("meetingBlock.takeMemo") }));
    await flush();
    expect(created).toHaveLength(1);
    expect(ed.insertBlocks).toHaveBeenCalledWith(
      [{ type: "paragraph", content: [{ type: "text", text: `@${created[0]}`, styles: { textColor: "blue" } }] }],
      block,
      "after",
    );
    expect(derived).toEqual([["memo-1", "link-1"]]);
    expect(ed.updateBlock).toHaveBeenCalledWith(block, { props: { memoNoteIds: JSON.stringify(["memo-1"]) } });
    expect(opened).toEqual(["memo-1"]);
  });

  it("サイドピークの中のブロック（メインエディタでない）には出さない", async () => {
    const { setMeetingNoteActions } = await import("../../features/meeting-recorder/note-actions");
    setMeetingNoteActions({
      isMainEditor: () => false,
      createLinkedNote: async () => null,
      openInSidePeek: () => {},
      linkDerived: () => {},
      loadNoteText: async () => null,
    });
    render(<MeetingTranscriptView block={block} editor={editor} />);
    await flush();
    expect(screen.queryByRole("button", { name: t("meetingBlock.takeMemo") })).toBeNull();
  });

  it("清書の手がかりは、メモのノートの本文 → ページの本文の順", async () => {
    const { setMeetingNoteActions } = await import("../../features/meeting-recorder/note-actions");
    const { collectMeetingHints } = await import("./view");
    setMeetingNoteActions({
      isMainEditor: () => true,
      createLinkedNote: async () => null,
      openInSidePeek: () => {},
      linkDerived: () => {},
      loadNoteText: async (id) => (id === "memo-1" ? "XRD は金曜" : null),
    });
    const withMemo = { ...block, props: { ...block.props, memoNoteIds: JSON.stringify(["memo-1"]) } };
    const page = {
      document: [{ id: "p1", type: "paragraph", content: [{ type: "text", text: "議題: 焼成温度" }], children: [] }, withMemo],
      getBlock: (id: string) => (id === withMemo.id ? withMemo : undefined),
    };
    expect(await collectMeetingHints(page, withMemo)).toBe("XRD は金曜\n議題: 焼成温度");
  });
});
