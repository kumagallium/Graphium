// @vitest-environment jsdom
// モバイルキャプチャビューの送信キュー配線テスト。
//
// 対象の不変条件:
// - モバイル連携の実験フラグ ON のとき: 下バーの 📷🎥🎙 で撮ったファイルは
//   enqueueForSend に渡り、成功したら送信キューシートが開く
//   （この端末には保存しない — 完全置き換え）
// - enqueueForSend が false（Google 未設定かつ Web Share 不可、IndexedDB 不可）の
//   ときだけ従来の onUploadMedia（ローカル保存）に落ちる
// - キュー経路が使える環境では、onUploadMedia が無くても撮影ボタンが出る
// - ヘッダーの送信キュー入口は、経路が使える or 送り残しがあるときに出る
// - 実験フラグ OFF（既定）のとき: キュー経路が使える環境設定でも入口は一切出ず、
//   撮ったファイルは従来どおり onUploadMedia（ローカル保存）へ行く
//
// usePushQueue はモック（キュー・認可の実物は hook 側の責務）。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MobileCaptureView } from "./MobileCaptureView";
import { setMobileInboxEnabled } from "./inbox/experimental";
import { LocaleProvider } from "../../i18n";
import type { PushQueueUi } from "./inbox/use-push-queue";

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

function capture(testIdFallback: string, files: File[]) {
  // 撮影入力は hidden なので accept 属性で特定する
  const input = document.querySelector(`input[accept="${testIdFallback}"]`) as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files } });
}

const jpeg = () =>
  new File([new Uint8Array([1, 2, 3]) as BlobPart], "image.jpg", { type: "image/jpeg" });

describe("MobileCaptureView 送信キュー配線", () => {
  it("routes captured media into the push queue and opens the send sheet", async () => {
    const enqueueForSend = vi.fn<(files: File[]) => Promise<boolean>>(async () => true);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onUploadMedia });

    capture("image/*", [jpeg()]);

    await waitFor(() => expect(enqueueForSend).toHaveBeenCalledTimes(1));
    expect(enqueueForSend.mock.calls[0][0]).toHaveLength(1);
    // ローカル保存には落ちず、シートが開く
    expect(onUploadMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("Send queue")).toBeTruthy());
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
    expect(screen.queryByText("Send queue")).toBeNull();
  });

  it("shows capture buttons without onUploadMedia when the queue route works", () => {
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="video/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="audio/*"]')).toBeTruthy();
  });

  it("hides capture buttons when neither the queue route nor local save exists", () => {
    usePushQueueMock.mockReturnValue(pushUi({ configured: false, canWebShare: false }));
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
  });

  it("offers the queue entry in the header and shows leftover count", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        configured: false,
        canWebShare: false,
        items: [
          {
            id: "a",
            name: "graphium-20260727-102030-01.jpg",
            mime: "image/jpeg",
            bytes: 1,
            enqueuedAt: "2026-07-27T10:20:30.000Z",
            status: "pending",
            attempts: 0,
          },
        ],
      }),
    );
    renderView();

    // 経路が使えなくても送り残しがあれば入口を出す（前回セッションの保全分）
    const entry = screen.getByRole("button", { name: "Open send queue" });
    expect(entry.textContent).toContain("1");
    fireEvent.click(entry);
    expect(screen.getByText("Send queue")).toBeTruthy();
  });

  it("hides the queue entry when the route is unavailable and the queue is empty", () => {
    usePushQueueMock.mockReturnValue(pushUi({ configured: false, canWebShare: false }));
    renderView();
    expect(screen.queryByRole("button", { name: "Open send queue" })).toBeNull();
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

  it("hides the header queue entry even when the queue route looks available", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          {
            id: "a",
            name: "graphium-20260727-102030-01.jpg",
            mime: "image/jpeg",
            bytes: 1,
            enqueuedAt: "2026-07-27T10:20:30.000Z",
            status: "pending",
            attempts: 0,
          },
        ],
      }),
    );
    renderView();
    expect(screen.queryByRole("button", { name: "Open send queue" })).toBeNull();
  });

  it("hides capture buttons without onUploadMedia (no silent dead-end route)", () => {
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
  });

  it("turning the flag ON at runtime reveals the queue entry without a reload", () => {
    renderView();
    expect(screen.queryByRole("button", { name: "Open send queue" })).toBeNull();
    // 設定モーダルのトグル相当。setMobileInboxEnabled が CustomEvent を飛ばし、
    // useMobileInboxFlag がその場で再レンダリングする（リロード不要の反映）
    act(() => {
      setMobileInboxEnabled(true);
    });
    expect(screen.getByRole("button", { name: "Open send queue" })).toBeTruthy();
  });
});
