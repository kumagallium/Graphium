// @vitest-environment jsdom
// ホームの捕獲履歴セクション（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - 捕獲履歴（送信対象）と過去のローカル項目を **1 本の時系列**（新しい順）に混ぜる
// - 送信済み（sent）は消えずに残り、控えめな見た目 + 「送信済み」バッジになる。
//   ローカル由来の行は状態バッジも削除ボタンも持たない（送信対象と混同しない）
// - 履歴もローカル項目も無いときはセクションごと畳む（null。捕獲の入口は画面下の
//   MobileCaptureBar が担うので、ここには何も残らない）
// - [送信 (n)] は見出し行の右端が定位置（リストより前 = 上に出る）。接続済み +
//   **未送信があるときだけ**。draining 中は無効 + 送信中表示
// - 接続 / 未設定の案内も未送信があるときだけ（送るものが無いのに接続を迫らない）
// - 送信中アイテムは進捗（%）が出て、削除ボタンが無効になる
// - failed があるときだけ再試行導線が出る
// - 画像は loadThumbnail（送信済みでも残る縮小 JPEG）で object URL サムネイルを作り、
//   unmount で revoke する。メモ / URL は実体が無くても preview で文字が残る
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import {
  CaptureHistorySection,
  type CaptureHistorySectionProps,
  type LocalCaptureItem,
} from "./CaptureHistorySection";
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

function sentItem(
  id: string,
  name: string,
  overrides: Partial<PushQueueItemMeta> = {},
): PushQueueItemMeta {
  return item(id, name, {
    status: "sent",
    sentAt: "2026-07-27T10:21:00.000Z",
    ...overrides,
  });
}

function localItem(overrides: Partial<LocalCaptureItem> = {}): LocalCaptureItem {
  return {
    id: "local-1",
    kind: "memo",
    title: "older local memo",
    timestamp: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

const baseProps: CaptureHistorySectionProps = {
  items: [],
  localItems: [],
  draining: false,
  activeId: null,
  progress: {},
  configured: true,
  connected: true,
  connecting: false,
  connectError: null,
  onSend: () => {},
  onOpenStoragePicker: () => {},
  onRemoveItem: () => {},
  onRetryFailed: () => {},
  onOpenSettings: () => {},
};

function renderSection(overrides: Partial<CaptureHistorySectionProps> = {}) {
  return render(
    <LocaleProvider>
      <CaptureHistorySection {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

/** 行の並び（DOM 順）を data-status 付きで読む。 */
function rowStates(): string[] {
  return Array.from(document.querySelectorAll("[data-testid=capture-history-row]")).map(
    (row) => row.getAttribute("data-status") ?? "",
  );
}

describe("CaptureHistorySection", () => {
  it("lists capture items under their normalized names with size and state", () => {
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
    // 接続済み + 未送信ありの送信ボタン
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
  });

  it("renders nothing at all while there is no history and no local item", () => {
    const { container } = renderSection({ items: [], localItems: [] });

    expect(container.querySelector("[data-testid=capture-history-block]")).toBeNull();
    // 捕獲の入口は MobileCaptureBar 側にあるので、空の履歴では何も出さない
    expect(container.firstElementChild).toBeNull();
  });

  it("keeps sent captures in the list, quietly marked as sent", () => {
    renderSection({ items: [sentItem("a", "graphium-20260727-102030-01.jpg")] });

    // 送っても消えない（撮った手応えが残る）
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    expect(rowStates()).toEqual(["sent"]);
    // 送るものが無いので送信ボタンも接続導線も出さない
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 履歴からの手動削除はできる
    expect(screen.getByRole("button", { name: "Remove from history" })).toBeTruthy();
  });

  it("merges push history and local items into one newest-first timeline", () => {
    renderSection({
      items: [
        item("new", "graphium-20260727-102030-01.jpg"), // 07-27 10:20
        sentItem("old", "graphium-20260725-090000-01.jpg", {
          enqueuedAt: "2026-07-25T09:00:00.000Z",
          sentAt: "2026-07-25T09:00:30.000Z",
        }),
      ],
      localItems: [
        localItem({ id: "l1", title: "older local memo", timestamp: "2026-07-26T08:00:00.000Z" }),
      ],
    });

    // 新しい順: pending(07-27) → local(07-26) → sent(07-25)
    expect(rowStates()).toEqual(["pending", "local", "sent"]);
    // ローカル行は状態バッジも削除ボタンも持たない（送信対象と混同させない）
    const local = document.querySelector("[data-status=local]")!;
    expect(local.querySelector("button")).toBeNull();
    expect(local.textContent).toContain("older local memo");
    expect(screen.getByText("1 unsent")).toBeTruthy();
  });

  it("opens a local row through onOpenLocalItem", () => {
    const onOpenLocalItem = vi.fn();
    renderSection({
      localItems: [localItem({ id: "l1", kind: "image", title: "photo.jpg" })],
      onOpenLocalItem,
    });

    fireEvent.click(screen.getByText("photo.jpg"));
    expect(onOpenLocalItem).toHaveBeenCalledTimes(1);
    expect(onOpenLocalItem.mock.calls[0][0]).toMatchObject({ id: "l1", kind: "image" });
  });

  it("anchors the send button in the heading row, above the list", () => {
    renderSection({
      items: [item("a", "graphium-a.jpg"), item("b", "graphium-b.jpg")],
    });

    const send = screen.getByRole("button", { name: /Send \(2\)/ });
    const firstRow = screen.getByText("graphium-b.jpg");
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
    expect(rowStates()).toEqual(["uploading"]);
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

  it("offers the storage picker entry when configured but not connected", () => {
    const onOpenStoragePicker = vi.fn();
    renderSection({
      connected: false,
      onOpenStoragePicker,
      items: [item("a", "graphium-a.jpg")],
    });

    // 主ボタンはプロバイダ名でなく「ストレージに接続」— タップでピッカーを開く
    // （Google/OneDrive/共有シートの選択と connect のジェスチャ契約はピッカー側）
    fireEvent.click(screen.getByRole("button", { name: "Connect storage" }));
    expect(onOpenStoragePicker).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
  });

  it("hides the connect and setup prompts once everything has been sent", () => {
    // 送るものが無い履歴だけの状態で接続を迫らない
    renderSection({ connected: false, items: [sentItem("a", "graphium-a.jpg")] });
    expect(screen.queryByRole("button", { name: "Connect storage" })).toBeNull();

    cleanup();
    renderSection({ configured: false, connected: false, items: [sentItem("a", "graphium-a.jpg")] });
    expect(screen.queryByText(/isn't set up yet/)).toBeNull();
  });

  it("points to Settings as the only action when no client ID is configured", () => {
    const onOpenSettings = vi.fn();
    renderSection({
      configured: false,
      connected: false,
      onOpenSettings,
      items: [item("a", "graphium-a.jpg")],
    });

    // 未設定の案内 + 設定導線のみ（かつての共有シートフォールバックは撤去済み）
    expect(screen.getByText(/isn't set up yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    // 見出しの送信ボタンも共有シートボタンも出ない
    expect(screen.queryByRole("button", { name: /Send \(1\)/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /share sheet/i })).toBeNull();
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
    // 未送信の件数は待機 + 失敗
    expect(screen.getByText("2 unsent")).toBeTruthy();
  });

  it("surfaces connect errors", () => {
    renderSection({
      connected: false,
      connectError: "Popup closed by user",
      items: [item("a", "graphium-a.jpg")],
    });
    expect(screen.getByText(/Popup closed by user/)).toBeTruthy();
  });

  it("builds image thumbnails from the stored thumbnail and revokes them on unmount", async () => {
    const loadThumbnail = vi.fn(async () =>
      new Blob([new Uint8Array([1]) as BlobPart], { type: "image/jpeg" }),
    );
    const { container, unmount } = renderSection({
      items: [
        // 送信済み（実体は捨てられている）でもサムネは出る
        sentItem("a", "graphium-a.jpg"),
        item("b", "graphium-b.m4a", { mime: "audio/mp4" }),
      ],
      loadThumbnail,
    });

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    // 画像だけがサムネを読む（音声は種別アイコンのまま）
    expect(loadThumbnail).toHaveBeenCalledTimes(1);
    expect(loadThumbnail).toHaveBeenCalledWith("a");
    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img?.getAttribute("src")).toBe("blob:thumb-1");
    });

    // 行が消える（削除・ビュー離脱）と必ず revoke される
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:thumb-1");
  });
});

describe("CaptureHistorySection — memo / URL 捕獲", () => {
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

  it("keeps the memo / url preview after the blob is discarded (sent rows)", () => {
    // 送信済み = 実体が読めない。enqueue 時にレコードへ写した preview で文字が残る
    renderSection({
      items: [
        sentItem("m", memoItem.name, {
          mime: memoItem.mime,
          preview: "queued thought",
        }),
        sentItem("u", urlItem.name, {
          mime: urlItem.mime,
          preview: "Example Read",
          previewUrl: "https://example.com/read",
        }),
      ],
      loadItemBlob: async () => null,
    });

    expect(screen.getByText("queued thought")).toBeTruthy();
    expect(screen.getByText("Example Read")).toBeTruthy();
    expect(screen.getByText("example.com")).toBeTruthy();
    expect(screen.queryByText(memoItem.name)).toBeNull();
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

  it("falls back to the file name when neither the payload nor a preview is available", () => {
    // loadItemBlob 無し・preview 無し（旧レコード）→ 名前表示のまま（何も壊れない）
    renderSection({ items: [memoItem] });
    expect(screen.getByText(memoItem.name)).toBeTruthy();
  });
});
