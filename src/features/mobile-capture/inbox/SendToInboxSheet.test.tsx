// @vitest-environment jsdom
// 送信キューシート（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - キューのアイテムは enqueue 時の正規化名 + サイズ + 状態で一覧に出る
// - モードで主アクションが切り替わる: 接続済み=送信 / 未接続=接続 / 未設定=共有 or 設定
// - 送信中アイテムは進捗（%）が出て、削除ボタンが無効になる
// - failed があるときだけ再試行導線が出る
// - 追加ピッカーは選んだファイルを onAddFiles に渡す（キューへの積み込みは親の責務）
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SendToInboxSheet, type SendToInboxSheetProps } from "./SendToInboxSheet";
import { LocaleProvider } from "../../../i18n";
import type { PushQueueItemMeta } from "./push";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

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

const baseProps: SendToInboxSheetProps = {
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
  onAddFiles: () => {},
  onSend: () => {},
  onConnect: () => {},
  onRemoveItem: () => {},
  onRetryFailed: () => {},
  onWebShare: () => {},
  onOpenSettings: () => {},
  onClose: () => {},
};

function renderSheet(overrides: Partial<SendToInboxSheetProps> = {}) {
  render(
    <LocaleProvider>
      <SendToInboxSheet {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("SendToInboxSheet", () => {
  it("lists queue items under their normalized names with size and state", () => {
    renderSheet({
      items: [
        item("a", "graphium-20260727-102030-01.jpg"),
        item("b", "graphium-20260727-102030-02.mov", { bytes: 12_400_000 }),
      ],
    });

    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByText("graphium-20260727-102030-02.mov")).toBeTruthy();
    expect(screen.getByText("400.0 KB")).toBeTruthy();
    expect(screen.getAllByText("Waiting")).toHaveLength(2);
    // 接続済みモードの主アクション（pending 2 件）
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
  });

  it("shows upload progress on the active item and locks its remove button", () => {
    renderSheet({
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
    renderSheet({ items: [item("a", "graphium-a.jpg")], onSend });

    fireEvent.click(screen.getByRole("button", { name: /Send \(1\)/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("offers Connect when configured but not connected, and calls it from the click", () => {
    const onConnect = vi.fn();
    renderSheet({ connected: false, onConnect, items: [item("a", "graphium-a.jpg")] });

    fireEvent.click(screen.getByRole("button", { name: "Connect Google Drive" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
  });

  it("falls back to the share sheet when no client ID is configured", () => {
    const onWebShare = vi.fn();
    const onOpenSettings = vi.fn();
    renderSheet({
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
    renderSheet({
      configured: false,
      connected: false,
      canWebShare: false,
      items: [item("a", "graphium-a.jpg")],
    });

    expect(screen.queryByRole("button", { name: /share sheet/ })).toBeNull();
    // 案内ボックスとフッターの 2 箇所
    expect(screen.getAllByRole("button", { name: "Open Settings" }).length).toBeGreaterThan(0);
  });

  it("shows the retry affordance only when something has failed", () => {
    const onRetryFailed = vi.fn();
    renderSheet({
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
    renderSheet({ onAddFiles });

    const input = screen.getByTestId("send-inbox-library") as HTMLInputElement;
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
    renderSheet({ connected: false, connectError: "Popup closed by user" });
    expect(screen.getByText(/Popup closed by user/)).toBeTruthy();
  });
});
