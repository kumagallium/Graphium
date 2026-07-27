// @vitest-environment jsdom
// ホームの送信キューセクション（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - キューのアイテムは enqueue 時の正規化名 + サイズ + 状態で一覧に出る
// - キューが空のときはブロックごと畳む（撮影ボタン行だけが残る）
// - モードで主アクションが切り替わる: 接続済み=送信 / 未接続=接続 /
//   未設定=案内+設定導線（+ canWebShare なら共有シート）
// - 送信中アイテムは進捗（%）が出て、削除ボタンが無効になる
// - failed があるときだけ再試行導線が出る
// - 撮影ボタン行のピッカーは選んだファイルを onAddFiles に渡す（キューへの
//   積み込みは親の責務）。showCaptureRow=false では行ごと消える
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
  showCaptureRow: true,
  onAddFiles: () => {},
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
    // 接続済みモードの主アクション（pending 2 件）
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
  });

  it("collapses the queue block entirely while empty, keeping the capture row", () => {
    renderSection({ items: [] });

    expect(screen.queryByTestId("send-queue-block")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 撮影ボタン行は残る（撮ればここに並ぶ）
    expect(screen.getByRole("button", { name: "Photo" })).toBeTruthy();
    expect(screen.getByTestId("send-queue-photo")).toBeTruthy();
  });

  it("hides the capture row when showCaptureRow is false but still lists leftovers", () => {
    renderSection({
      showCaptureRow: false,
      items: [item("a", "graphium-a.jpg")],
    });

    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
    expect(screen.queryByTestId("send-queue-photo")).toBeNull();
    // 前回セッションの送り残しは見える（保全）
    expect(screen.getByText("graphium-a.jpg")).toBeTruthy();
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
  });

  it("fires onSend from the manual send button", () => {
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
    // 主アクションは共有シート
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

  it("hands picked files to onAddFiles and resets the input", () => {
    const onAddFiles = vi.fn();
    renderSection({ onAddFiles });

    const input = screen.getByTestId("send-queue-library") as HTMLInputElement;
    const files = [
      new File([new Uint8Array([1]) as BlobPart], "image.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2]) as BlobPart], "clip.mov", { type: "video/quicktime" }),
    ];
    fireEvent.change(input, { target: { files } });

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles.mock.calls[0][0]).toHaveLength(2);
    expect(input.value).toBe("");
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
