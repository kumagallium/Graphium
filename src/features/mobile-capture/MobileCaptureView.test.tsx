// @vitest-environment jsdom
// モバイルキャプチャビュー（キュー前提ホーム）の配線テスト。
//
// 対象の不変条件:
// - モバイル連携の実験フラグ ON のとき: ホームに撮影ボタン行 + 未送信キューが
//   インラインで出る。撮ったファイルは enqueueForSend に渡り、シートは開かない
//   （SendToInboxSheet 自体が存在しない。この端末には保存しない — 完全置き換え）
// - キューが空のときはキューブロックが畳まれ、撮影ボタン行だけが残る
// - メモ作成・タイムラインはキューの下にそのまま共存する（1 スクロール・機能後退なし）
// - enqueueForSend が false（Google 未設定かつ Web Share 不可、IndexedDB 不可）の
//   ときだけ従来の onUploadMedia（ローカル保存）に落ちる
// - キュー経路が使える環境では、onUploadMedia が無くても撮影ボタンが出る
// - ヘッダーの接続状態チップは 接続済み / 未接続 / 未設定 を出し分ける
// - 実験フラグ OFF（既定）のとき: チップもキューも一切出ず、従来ホームのまま
//   （撮ったファイルは onUploadMedia へ、下バーに撮影ボタン）
//
// usePushQueue はモック（キュー・認可の実物は hook 側の責務）。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MobileCaptureView } from "./MobileCaptureView";
import { setMobileInboxEnabled } from "./inbox/experimental";
import { LocaleProvider } from "../../i18n";
import type { PushQueueUi } from "./inbox/use-push-queue";
import type { PushQueueItemMeta } from "./inbox/push";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usePushQueueMock = vi.fn<() => PushQueueUi>();

vi.mock("./inbox/use-push-queue", () => ({
  usePushQueue: () => usePushQueueMock(),
}));

// MediaPreview（→ PdfViewer → react-pdf）の import 連鎖対策。react-pdf は import
// しただけで pdfjs が DOMMatrix を触り jsdom では落ちる（InboxView.test.tsx と同じ）。
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));

afterEach(cleanup);

function queueItem(id: string, name: string): PushQueueItemMeta {
  return {
    id,
    name,
    mime: "image/jpeg",
    bytes: 409_600,
    enqueuedAt: "2026-07-27T10:20:30.000Z",
    status: "pending",
    attempts: 0,
  };
}

function pushUi(overrides: Partial<PushQueueUi> = {}): PushQueueUi {
  return {
    ready: true,
    configured: true,
    connected: true,
    connecting: false,
    connectError: null,
    canWebShare: false,
    items: [],
    draining: false,
    activeId: null,
    progress: {},
    enqueueForSend: vi.fn(async () => true),
    drainNow: vi.fn(),
    connectAndDrain: vi.fn(),
    removeItem: vi.fn(),
    retryFailed: vi.fn(),
    shareViaWebShare: vi.fn(async () => null),
    getItemFile: vi.fn(async () => null),
    refreshStatus: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  usePushQueueMock.mockReturnValue(pushUi());
  // 既存の配線テストはすべて「モバイル連携 ON」前提（フラグ自体の既定は OFF）
  localStorage.clear();
  setMobileInboxEnabled(true);
});

function renderView(props: Partial<Parameters<typeof MobileCaptureView>[0]> = {}) {
  return render(
    <LocaleProvider>
      <MobileCaptureView
        captureIndex={{ version: 1, updatedAt: "2026-07-27T00:00:00.000Z", captures: [] }}
        loading={false}
        onCreateCapture={async () => {}}
        creating={false}
        {...props}
      />
    </LocaleProvider>,
  );
}

function capture(acceptAttr: string, files: File[]) {
  // 撮影入力は hidden なので accept 属性で特定する
  const input = document.querySelector(`input[accept="${acceptAttr}"]`) as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files } });
}

const jpeg = () =>
  new File([new Uint8Array([1, 2, 3]) as BlobPart], "image.jpg", { type: "image/jpeg" });

describe("キュー前提ホーム（実験フラグ ON）", () => {
  it("shows the capture row and the inline queue with its send action", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          queueItem("a", "graphium-20260727-102030-01.jpg"),
          queueItem("b", "graphium-20260727-102030-02.jpg"),
        ],
      }),
    );
    renderView();

    // 撮影ボタン行（写真/動画/音声/ライブラリから）
    expect(screen.getByRole("button", { name: "Photo" })).toBeTruthy();
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    // キューがホームにインラインで出る（クリック不要）
    expect(screen.getByText("Send queue")).toBeTruthy();
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
  });

  it("routes captured media into the push queue without opening anything", async () => {
    const enqueueForSend = vi.fn<(files: File[]) => Promise<boolean>>(async () => true);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onUploadMedia });

    capture("image/*", [jpeg()]);

    await waitFor(() => expect(enqueueForSend).toHaveBeenCalledTimes(1));
    expect(enqueueForSend.mock.calls[0][0]).toHaveLength(1);
    // ローカル保存には落ちない。シートは存在しないので何も開かない —
    // アイテムはキュー購読経由でインライン一覧に現れる（ここでは snapshot が
    // 空のままなのでキューブロックも出ない）
    expect(onUploadMedia).not.toHaveBeenCalled();
    expect(screen.queryByTestId("send-queue-block")).toBeNull();
  });

  it("collapses the queue block while empty, keeping the capture row", () => {
    renderView();

    expect(screen.queryByTestId("send-queue-block")).toBeNull();
    expect(screen.queryByText("Send queue")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 撮影ボタン行は残る
    expect(screen.getByRole("button", { name: "Photo" })).toBeTruthy();
  });

  it("keeps memo creation and the timeline below the queue (one scroll, no tabs)", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({ items: [queueItem("a", "graphium-20260727-102030-01.jpg")] }),
    );
    renderView({
      captureIndex: {
        version: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
        captures: [
          { id: "m1", text: "timeline memo", createdAt: "2026-07-27T09:00:00.000Z" },
        ],
      },
    });

    const queueName = screen.getByText("graphium-20260727-102030-01.jpg");
    const memoCard = screen.getByText("timeline memo");
    // タイムラインのメモはキューの後（下）に出る
    expect(
      queueName.compareDocumentPosition(memoCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // 下バーのメモ作成ボタンも健在
    expect(screen.getByRole("button", { name: /New Memo/ })).toBeTruthy();
  });

  it("falls back to local save only when the queue route is unavailable", async () => {
    const enqueueForSend = vi.fn(async () => false);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(
      pushUi({ configured: false, canWebShare: false, enqueueForSend }),
    );
    renderView({ onUploadMedia });

    capture("image/*", [jpeg()]);

    await waitFor(() => expect(onUploadMedia).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("send-queue-block")).toBeNull();
  });

  it("shows capture buttons without onUploadMedia when the queue route works", () => {
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="video/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="audio/*"]')).toBeTruthy();
  });

  it("hides the capture row when neither the queue route nor local save exists, but still lists leftovers", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        configured: false,
        canWebShare: false,
        items: [queueItem("a", "graphium-20260727-102030-01.jpg")],
      }),
    );
    renderView({ onUploadMedia: undefined });

    // 撮影ボタン行は出ない（袋小路の経路を作らない）
    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
    // 前回セッションの送り残しは見え、未設定の案内が付く
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
  });

  it("branches the primary action by connection state (connect wiring)", () => {
    const connectAndDrain = vi.fn();
    usePushQueueMock.mockReturnValue(
      pushUi({
        connected: false,
        connectAndDrain,
        items: [queueItem("a", "graphium-a.jpg")],
      }),
    );
    renderView();

    const connect = screen.getByRole("button", { name: "Connect Google Drive" });
    fireEvent.click(connect);
    expect(connectAndDrain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
  });

  it("shows the header connection chip per state: connected / disconnected / not set up", () => {
    // 接続済み
    const first = renderView();
    expect(screen.getByText("Connected")).toBeTruthy();
    first.unmount();

    // 未接続
    usePushQueueMock.mockReturnValue(pushUi({ connected: false }));
    const second = renderView();
    expect(screen.getByText("Not connected")).toBeTruthy();
    second.unmount();

    // 未設定
    usePushQueueMock.mockReturnValue(pushUi({ configured: false, connected: false }));
    renderView();
    expect(screen.getByText("Not set up")).toBeTruthy();
  });

  it("hides the chip until the push module is ready (no provisional lies)", () => {
    usePushQueueMock.mockReturnValue(pushUi({ ready: false, configured: false, connected: false }));
    renderView();
    expect(screen.queryByText("Not set up")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
  });
});

describe("モバイル連携 実験フラグ OFF（既定）のゲート", () => {
  beforeEach(() => {
    // beforeEach で ON にした分を戻す = 出荷時の既定状態
    setMobileInboxEnabled(false);
  });

  it("keeps the legacy local-save path: captures go to onUploadMedia, not the queue", async () => {
    const enqueueForSend = vi.fn(async () => true);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onUploadMedia });

    capture("image/*", [jpeg()]);

    await waitFor(() => expect(onUploadMedia).toHaveBeenCalledTimes(1));
    expect(enqueueForSend).not.toHaveBeenCalled();
    expect(screen.queryByText("Send queue")).toBeNull();
  });

  it("shows neither the queue section nor the chip even when the route looks available", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({ items: [queueItem("a", "graphium-20260727-102030-01.jpg")] }),
    );
    renderView({ onUploadMedia: async () => "file-id" });

    // キューブロック・見出し・チップのいずれも出ない（従来ホームのまま）
    expect(screen.queryByTestId("send-queue-block")).toBeNull();
    expect(screen.queryByText("Send queue")).toBeNull();
    expect(screen.queryByText("Connected")).toBeNull();
    // 撮影ボタンは従来どおり下バー（撮影行の「Photo」ラベルは無い）
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
  });

  it("hides capture buttons without onUploadMedia (no silent dead-end route)", () => {
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
  });

  it("turning the flag ON at runtime reveals the inline queue without a reload", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({ items: [queueItem("a", "graphium-20260727-102030-01.jpg")] }),
    );
    renderView();
    expect(screen.queryByText("Send queue")).toBeNull();
    // 設定モーダルのトグル相当。setMobileInboxEnabled が CustomEvent を飛ばし、
    // useMobileInboxFlag がその場で再レンダリングする（リロード不要の反映）
    act(() => {
      setMobileInboxEnabled(true);
    });
    expect(screen.getByText("Send queue")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send \(1\)/ })).toBeTruthy();
  });
});
