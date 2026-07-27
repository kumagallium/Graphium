// @vitest-environment jsdom
// ホームの送信キューセクション（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - キューのアイテムは enqueue 時の正規化名 + サイズ + 状態で一覧に出る
// - キューが空のときはセクションごと畳む（null。捕獲の入口は画面下の
//   MobileCaptureBar が担うので、ここには何も残らない）
// - [送信 (n)] は見出し行の右端が定位置（リストより前 = 上に出る）。
//   接続済みモードのみ。draining 中は無効 + 送信中表示
// - モードでリスト下の主アクションが切り替わる: 接続済み=なし（見出しの送信）/
//   未接続=接続 / 未設定=案内+設定導線（+ canWebShare なら共有シート）
// - 送信中アイテムは進捗（%）が出て、削除ボタンが無効になる
// - failed があるときだけ再試行導線が出る
// - 画像アイテムは loadItemBlob で object URL サムネイルを作り、unmount で revoke する
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { SendQueueSection, type SendQueueSectionProps } from "./SendQueueSection";
import { LocaleProvider } from "../../../i18n";
import type { PushQueueItemMeta } from "./push";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は URL.createObjectURL を持たないのでスタブする（サムネイルのライフサイクル観測）
const createObjectURL = vi.fn(() => "blob:thumb-1");
const revokeObjectURL = vi.fn();
beforeAll(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  cleanup();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

function item(
  id: string,
  name: string,
  overrides: Partial<PushQueueItemMeta> = {},
): PushQueueItemMeta {
  return {
    id,
    name,
    mime: "image/jpeg",
    bytes: 409_600,
    enqueuedAt: "2026-07-27T10:20:30.000Z",
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

const baseProps: SendQueueSectionProps = {
  items: [],
  draining: false,
  activeId: null,
  progress: {},
  configured: true,
  connected: true,
  connecting: false,
  connectError: null,
  canWebShare: false,
  webShareError: null,
  onSend: () => {},
  onConnect: () => {},
  onRemoveItem: () => {},
  onRetryFailed: () => {},
  onWebShare: () => {},
  onOpenSettings: () => {},
};

function renderSection(overrides: Partial<SendQueueSectionProps> = {}) {
  return render(
    <LocaleProvider>
      <SendQueueSection {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("SendQueueSection", () => {
  it("lists queue items under their normalized names with size and state", () => {
    renderSection({
      items: [
        item("a", "graphium-20260727-102030-01.jpg"),
        item("b", "graphium-20260727-102030-02.mov", {
          bytes: 12_400_000,
          mime: "video/quicktime",
        }),
      ],
    });

    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByText("graphium-20260727-102030-02.mov")).toBeTruthy();
    expect(screen.getByText("400.0 KB")).toBeTruthy();
    expect(screen.getAllByText("Waiting")).toHaveLength(2);
    // 接続済みモードの送信ボタン（pending 2 件）
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
  });

  it("renders nothing at all while the queue is empty", () => {
    const { container } = renderSection({ items: [] });

    expect(container.querySelector("[data-testid=send-queue-block]")).toBeNull();
    // 捕獲の入口は MobileCaptureBar 側にあるので、空キューでは何も出さない
    expect(container.firstElementChild).toBeNull();
  });

  it("anchors the send button in the heading row, above the list", () => {
    renderSection({
      items: [item("a", "graphium-a.jpg"), item("b", "graphium-b.jpg")],
    });

    const send = screen.getByRole("button", { name: /Send \(2\)/ });
    const firstRow = screen.getByText("graphium-a.jpg");
    // 見出し行（送信ボタン）はリストより前 = リストが伸びても位置が動かない
    expect(
      send.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows upload progress on the active item and locks its remove button", () => {
    renderSection({
      items: [item("a", "graphium-20260727-102030-01.jpg")],
      draining: true,
      activeId: "a",
      progress: { a: { sentBytes: 204_800, totalBytes: 409_600 } },
    });

    expect(screen.getByText("Sending... 50%")).toBeTruthy();
    const remove = screen.getByRole("button", { name: "Remove from queue" });
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    // 見出し行の送信ボタンは送信中表示 + 無効
    const send = screen.getByRole("button", { name: /Sending/ });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("fires onSend from the heading send button", () => {
    const onSend = vi.fn();
    renderSection({ items: [item("a", "graphium-a.jpg")], onSend });

    fireEvent.click(screen.getByRole("button", { name: /Send \(1\)/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("offers Connect when configured but not connected, and calls it from the click", () => {
    const onConnect = vi.fn();
    renderSection({ connected: false, onConnect, items: [item("a", "graphium-a.jpg")] });

    fireEvent.click(screen.getByRole("button", { name: "Connect Google Drive" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 接続の意味（どこへ送られるか）はこのモードで添える
    expect(screen.getByText(/Graphium\/Inbox/)).toBeTruthy();
  });

  it("falls back to the share sheet when no client ID is configured", () => {
    const onWebShare = vi.fn();
    const onOpenSettings = vi.fn();
    renderSection({
      configured: false,
      connected: false,
      canWebShare: true,
      onWebShare,
      onOpenSettings,
      items: [item("a", "graphium-a.jpg")],
    });

    // 未設定の案内 + 設定導線
    expect(screen.getByText(/isn't set up yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // 主アクションは共有シート（見出しの送信ボタンは出ない）
    expect(screen.queryByRole("button", { name: /Send \(1\)/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Send via share sheet \(1\)/ }));
    expect(onWebShare).toHaveBeenCalledTimes(1);
  });

  it("points to Settings as the only action when neither Drive nor Web Share is available", () => {
    renderSection({
      configured: false,
      connected: false,
      canWebShare: false,
      items: [item("a", "graphium-a.jpg")],
    });

    expect(screen.queryByRole("button", { name: /share sheet/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
  });

  it("shows the retry affordance only when something has failed", () => {
    const onRetryFailed = vi.fn();
    renderSection({
      items: [
        item("a", "graphium-a.jpg"),
        item("b", "graphium-b.jpg", {
          status: "failed",
          attempts: 5,
          lastError: "Drive multipart upload failed (500)",
        }),
      ],
      onRetryFailed,
    });

    expect(screen.getByText("Drive multipart upload failed (500)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Retry failed \(1\)/ }));
    expect(onRetryFailed).toHaveBeenCalledTimes(1);
    // failed は送信対象から外れているので Send のカウントは pending のみ
    expect(screen.getByRole("button", { name: /Send \(1\)/ })).toBeTruthy();
  });

  it("surfaces connect errors", () => {
    renderSection({
      connected: false,
      connectError: "Popup closed by user",
      items: [item("a", "graphium-a.jpg")],
    });
    expect(screen.getByText(/Popup closed by user/)).toBeTruthy();
  });

  it("builds image thumbnails from the queued blob and revokes them on unmount", async () => {
    const loadItemBlob = vi.fn(async () =>
      new Blob([new Uint8Array([1]) as BlobPart], { type: "image/jpeg" }),
    );
    const { container, unmount } = renderSection({
      items: [
        item("a", "graphium-a.jpg"),
        item("b", "graphium-b.m4a", { mime: "audio/mp4" }),
      ],
      loadItemBlob,
    });

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    // 画像だけが Blob を読む（音声は種別アイコンのまま）
    expect(loadItemBlob).toHaveBeenCalledTimes(1);
    expect(loadItemBlob).toHaveBeenCalledWith("a");
    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("blob:thumb-1");
    });

    // 行が消える（削除・送信完了・ビュー離脱）と必ず revoke される
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:thumb-1");
  });
});

describe("SendQueueSection — memo / URL 捕獲", () => {
  const memoItem = item("m", "graphium-20260727-153000-01-memo.graphium.json", {
    mime: "application/vnd.graphium.capture+json",
    bytes: 120,
  });
  const urlItem = item("u", "graphium-20260727-153000-02-url.graphium.json", {
    mime: "application/vnd.graphium.capture+json",
    bytes: 180,
  });
  const payloads: Record<string, unknown> = {
    m: {
      graphium: 1,
      kind: "memo",
      createdAt: "2026-07-27T06:30:00.000Z",
      text: "queued thought\nsecond line",
    },
    u: {
      graphium: 1,
      kind: "url",
      createdAt: "2026-07-27T06:31:00.000Z",
      url: "https://example.com/read",
      title: "Example Read",
    },
  };
  const loadCaptureBlob = (id: string): Promise<Blob | null> =>
    Promise.resolve(
      payloads[id]
        ? new Blob([JSON.stringify(payloads[id])], {
            type: "application/vnd.graphium.capture+json",
          })
        : null,
    );

  it("renders a memo row as icon + first-line preview instead of the file name", async () => {
    renderSection({ items: [memoItem], loadItemBlob: loadCaptureBlob });

    // ペイロード読込後は本文先頭がプレビューとして出る（ファイル名は出さない）
    await waitFor(() => expect(screen.getByText("queued thought")).toBeTruthy());
    expect(screen.queryByText(memoItem.name)).toBeNull();
    // 種別ラベル（メモ）+ 状態
    expect(screen.getByText("Memo")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
  });

  it("renders a url row as title + domain", async () => {
    renderSection({ items: [urlItem], loadItemBlob: loadCaptureBlob });

    await waitFor(() => expect(screen.getByText("Example Read")).toBeTruthy());
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.queryByText(urlItem.name)).toBeNull();
  });

  it("mixes capture rows with media rows in the same list and keeps the send count", async () => {
    renderSection({
      items: [item("a", "graphium-20260727-153000-03.jpg"), memoItem, urlItem],
      loadItemBlob: loadCaptureBlob,
    });

    expect(screen.getByText("graphium-20260727-153000-03.jpg")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("queued thought")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Example Read")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Send \(3\)/ })).toBeTruthy();
  });

  it("falls back to the file name when the payload cannot be read", () => {
    // loadItemBlob 無し（読めない環境）→ 名前表示のまま（何も壊れない）
    renderSection({ items: [memoItem] });
    expect(screen.getByText(memoItem.name)).toBeTruthy();
  });
});
