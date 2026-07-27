// @vitest-environment jsdom
// モバイルキャプチャビュー（キュー前提ホーム）の配線テスト。
//
// 対象の不変条件:
// - モバイル連携の実験フラグ ON のとき: 未送信キューがコンテンツ最上部にインラインで
//   出る（[送信 (n)] は見出し行右端の定位置）。捕獲ボタンは画面下固定の捕獲バー
//   （[書く][URL][写真][動画][音声][ライブラリ]）— キューより後（下）に出る。
//   撮ったファイルは enqueueForSend に渡り、シートは開かない（SendToInboxSheet 自体が
//   存在しない。この端末には保存しない — 完全置き換え）
// - メモ・URL も捕獲物としてキュー行き（ネイティブ JSON）。ローカルの capture-store /
//   media-index には保存しない
// - キューが空のときはキューセクションごと畳まれ、下の捕獲バーだけが残る
// - タイムライン（過去分の閲覧）はキューの下にそのまま共存する（1 スクロール）
// - enqueueForSend が false（Google 未設定、IndexedDB 不可）のときだけ
//   従来のローカル保存（メディア=onUploadMedia / メモ=onCreateCapture /
//   URL=onAddUrlBookmark）に落ちる
// - キュー経路が使える環境では、onUploadMedia が無くても撮影ボタンが出る
// - ヘッダーの接続状態チップは 接続済み / 未接続 / 未設定 を出し分ける
// - スマホにフル設定モーダルは出さない: フラグ ON のヘッダー ⚙ は最小設定シート
//   （MobileSettingsSheet）を開き、`graphium-open-settings` は飛ばさない。
//   未接続時の主ボタンはストレージ選択（StoragePickerSheet）を開き、Google 行が
//   接続の実体（ON=connectAndDrain / OFF=usePushSettings.connectGoogle）につながる
// - 実験フラグ OFF（既定）のとき: チップもキューも ⚙ も出ず、従来ホーム +
//   タイムライン上部の実験オプトインカードだけ（撮ったファイルは onUploadMedia へ）。
//   [試す] → ピッカー → 接続成功（onConnected）でフラグが立ち、ホームがキュー化する
//
// usePushQueue / usePushSettings はモック（キュー・認可の実物は hook 側の責務）。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { MobileCaptureView } from "./MobileCaptureView";
import { isMobileInboxEnabled, setMobileInboxEnabled } from "./inbox/experimental";
import { parseGraphiumCaptureFile } from "./inbox/capture-file";
import { LocaleProvider } from "../../i18n";
import type { PushQueueUi } from "./inbox/use-push-queue";
import type { PushSettingsUi } from "./inbox/use-push-settings";
import type { PushQueueItemMeta } from "./inbox/push";

// UrlBookmarkModal の fetchUrlMetadata は実ネットワークに出る（jsdom でも global fetch が
// 生きている）ため、メタ取得だけ差し替える。それ以外の media-index API は実物を使う。
vi.mock("../asset-browser/media-index", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../asset-browser/media-index")>();
  return {
    ...mod,
    fetchUrlMetadata: vi.fn(async () => ({ title: "Example Read", domain: "example.com" })),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const usePushQueueMock = vi.fn<() => PushQueueUi>();

vi.mock("./inbox/use-push-queue", () => ({
  usePushQueue: () => usePushQueueMock(),
}));

// スタンドアロン push 設定（オプトイン接続・最小設定シート）もモック。
// onConnected（接続成功でフラグを立てる親のコールバック）を捕まえて、
// テストから「接続成功」を同期シミュレートできるようにする。
const usePushSettingsMock = vi.fn<() => PushSettingsUi>();
let lastOnConnected: (() => void) | undefined;

vi.mock("./inbox/use-push-settings", () => ({
  usePushSettings: (_active: boolean, opts?: { onConnected?: () => void }) => {
    lastOnConnected = opts?.onConnected;
    return usePushSettingsMock();
  },
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
    items: [],
    draining: false,
    activeId: null,
    progress: {},
    enqueueForSend: vi.fn(async () => true),
    drainNow: vi.fn(),
    connectAndDrain: vi.fn(),
    removeItem: vi.fn(),
    retryFailed: vi.fn(),
    getItemFile: vi.fn(async () => null),
    refreshStatus: vi.fn(),
    ...overrides,
  };
}

function pushSettingsUi(overrides: Partial<PushSettingsUi> = {}): PushSettingsUi {
  return {
    ready: true,
    configured: true,
    connected: false,
    hasBundledId: true,
    clientIdOverride: "",
    connecting: false,
    connectError: null,
    connectGoogle: vi.fn(),
    disconnect: vi.fn(),
    saveClientId: vi.fn(),
    clearClientId: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  usePushQueueMock.mockReturnValue(pushUi());
  usePushSettingsMock.mockReturnValue(pushSettingsUi());
  lastOnConnected = undefined;
  // 既存の配線テストはすべて「モバイル連携 ON」前提（フラグ自体の既定は OFF）
  localStorage.clear();
  setMobileInboxEnabled(true);
});

function buildView(props: Partial<Parameters<typeof MobileCaptureView>[0]> = {}) {
  return (
    <LocaleProvider>
      <MobileCaptureView
        captureIndex={{ version: 1, updatedAt: "2026-07-27T00:00:00.000Z", captures: [] }}
        loading={false}
        onCreateCapture={async () => {}}
        creating={false}
        {...props}
      />
    </LocaleProvider>
  );
}

function renderView(props: Partial<Parameters<typeof MobileCaptureView>[0]> = {}) {
  return render(buildView(props));
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
  it("shows the inline queue on top and the capture bar fixed at the bottom", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          queueItem("a", "graphium-20260727-102030-01.jpg"),
          queueItem("b", "graphium-20260727-102030-02.jpg"),
        ],
      }),
    );
    renderView();

    // 捕獲バー（書く/URL/写真/動画/音声/ライブラリ）と撮影入力
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo" })).toBeTruthy();
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    // キューがホームにインラインで出る（クリック不要）。送信は見出し行の定位置
    expect(screen.getByText("Send queue")).toBeTruthy();
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send \(2\)/ })).toBeTruthy();
    // 並び: キュー（コンテンツ最上部）→ … → 捕獲バー（画面下）
    const queueName = screen.getByText("graphium-20260727-102030-01.jpg");
    const photoButton = screen.getByRole("button", { name: "Photo" });
    expect(
      queueName.compareDocumentPosition(photoButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("collapses the queue section while empty, keeping the bottom capture bar", () => {
    renderView();

    expect(screen.queryByTestId("send-queue-block")).toBeNull();
    expect(screen.queryByText("Send queue")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 捕獲バーは残る
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
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
    // メモ作成は捕獲バーの [書く]（従来のメモ作成ボタンは無い）
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New Memo/ })).toBeNull();
  });

  it("routes a composed memo into the queue as native JSON (not the local capture store)", async () => {
    const enqueueForSend = vi.fn<(files: File[]) => Promise<boolean>>(async () => true);
    const onCreateCapture = vi.fn(async () => {});
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onCreateCapture });

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    const textarea = await screen.findByPlaceholderText(/Write your memo here/);
    fireEvent.change(textarea, { target: { value: "queued thought" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(enqueueForSend).toHaveBeenCalledTimes(1));
    const file = enqueueForSend.mock.calls[0][0][0];
    expect(file.name).toBe("memo.graphium.json");
    const payload = parseGraphiumCaptureFile(file.name, await file.text());
    expect(payload).toMatchObject({ kind: "memo", text: "queued thought" });
    // ローカルの capture-store には保存しない（捕獲物は全部 Inbox へ）
    expect(onCreateCapture).not.toHaveBeenCalled();
    // ダイアログは閉じる
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Write your memo here/)).toBeNull(),
    );
  });

  it("falls back to the local capture store for memos when the queue route is unavailable", async () => {
    const enqueueForSend = vi.fn(async () => false);
    const onCreateCapture = vi.fn(async () => {});
    usePushQueueMock.mockReturnValue(pushUi({ configured: false, enqueueForSend }));
    renderView({ onCreateCapture, onUploadMedia: async () => "file-id" });

    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    const textarea = await screen.findByPlaceholderText(/Write your memo here/);
    fireEvent.change(textarea, { target: { value: "kept locally" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onCreateCapture).toHaveBeenCalledWith("kept locally"));
  });

  it("routes a registered URL into the queue as native JSON with its metadata", async () => {
    const enqueueForSend = vi.fn<(files: File[]) => Promise<boolean>>(async () => true);
    const onAddUrlBookmark = vi.fn();
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onAddUrlBookmark });

    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    const input = await screen.findByPlaceholderText("https://example.com/article");
    fireEvent.change(input, { target: { value: "https://example.com/read" } });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => expect(enqueueForSend).toHaveBeenCalledTimes(1));
    const file = enqueueForSend.mock.calls[0][0][0];
    expect(file.name).toBe("url.graphium.json");
    const payload = parseGraphiumCaptureFile(file.name, await file.text());
    expect(payload).toMatchObject({ kind: "url", url: "https://example.com/read" });
    // ローカルの media-index には登録しない
    expect(onAddUrlBookmark).not.toHaveBeenCalled();
  });

  it("falls back to local save only when the queue route is unavailable", async () => {
    const enqueueForSend = vi.fn(async () => false);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(pushUi({ configured: false, enqueueForSend }));
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

  it("hides the media capture buttons when neither the queue route nor local save exists, but still lists leftovers", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        configured: false,
        items: [queueItem("a", "graphium-20260727-102030-01.jpg")],
      }),
    );
    renderView({ onUploadMedia: undefined });

    // 捕獲バーの撮影ボタンは出ない（袋小路の経路を作らない）。[書く] は退路があるので残る
    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    // 前回セッションの送り残しは見え、未設定の案内が付く
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
  });

  it("opens the storage picker from the queue's connect button and wires Google to connectAndDrain", () => {
    const connectAndDrain = vi.fn();
    usePushQueueMock.mockReturnValue(
      pushUi({
        connected: false,
        connectAndDrain,
        items: [queueItem("a", "graphium-a.jpg")],
      }),
    );
    renderView();

    // 未接続時の主ボタンはプロバイダ直結でなくストレージ選択を開く
    fireEvent.click(screen.getByRole("button", { name: "Connect storage" }));
    expect(screen.getByTestId("storage-picker-sheet")).toBeTruthy();
    // OneDrive は「準備中」枠で無効（P1.5 で活性化）
    const oneDrive = screen.getByRole("button", { name: /OneDrive/ });
    expect((oneDrive as HTMLButtonElement).disabled).toBe(true);
    // Google 行の click がキュー配線の connectAndDrain へ（同期契約は hook 側）
    fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
    expect(connectAndDrain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
  });

  it("closes the picker once the queue-side connect succeeds", () => {
    const items = [queueItem("a", "graphium-a.jpg")];
    usePushQueueMock.mockReturnValue(pushUi({ connected: false, items }));
    const view = renderView();

    fireEvent.click(screen.getByRole("button", { name: "Connect storage" }));
    fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
    expect(screen.getByTestId("storage-picker-sheet")).toBeTruthy();

    // connect 成功（connected へ遷移）で自動クローズ。
    // 「開いた時点で既に接続済み」（設定シートの [変更] 経由）では閉じない —
    // 接続要求をしたときだけ閉じる遷移検知
    usePushQueueMock.mockReturnValue(pushUi({ connected: true, items }));
    view.rerender(buildView());
    expect(screen.queryByTestId("storage-picker-sheet")).toBeNull();
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

  it("opens the minimal settings sheet from the header gear (never the full settings modal)", () => {
    const events: CustomEvent[] = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("graphium-open-settings", listener);
    try {
      renderView();
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      // スマホ専用の最小設定シート（ストレージ / 言語 / アプリ情報 / 実験離脱）
      expect(screen.getByTestId("mobile-settings-sheet")).toBeTruthy();
      expect(screen.getByText("Leave this experiment")).toBeTruthy();
      expect(screen.getByText("Language")).toBeTruthy();
      // フル設定モーダルを開くイベントは飛ばさない
      expect(events).toHaveLength(0);
    } finally {
      window.removeEventListener("graphium-open-settings", listener);
    }
  });

  it("wires disconnect in the sheet and returns to the legacy home via leave-experiment", () => {
    const disconnect = vi.fn();
    usePushSettingsMock.mockReturnValue(pushSettingsUi({ connected: true, disconnect }));
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledTimes(1);

    // 「この実験をやめる」= フラグを下ろすだけ（キュー・接続はこの端末に残る）。
    // シートが閉じ、従来ホーム（New Memo の下バー + オプトインカード）へ戻る
    fireEvent.click(screen.getByRole("button", { name: "Leave this experiment" }));
    expect(isMobileInboxEnabled()).toBe(false);
    expect(screen.queryByTestId("mobile-settings-sheet")).toBeNull();
    expect(screen.getByRole("button", { name: /New Memo/ })).toBeTruthy();
    expect(screen.getByTestId("mobile-optin-card")).toBeTruthy();
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

  it("keeps the legacy memo path: the bottom-bar New Memo saves locally, never the queue", async () => {
    const enqueueForSend = vi.fn(async () => true);
    const onCreateCapture = vi.fn(async () => {});
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onCreateCapture });

    // 下バーのメモ作成はそのまま（[書く] 捕獲ボタンは無い）
    expect(screen.queryByRole("button", { name: "Write" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /New Memo/ }));
    const textarea = await screen.findByPlaceholderText(/Write your memo here/);
    fireEvent.change(textarea, { target: { value: "kept locally" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });

    await waitFor(() => expect(onCreateCapture).toHaveBeenCalledWith("kept locally"));
    expect(enqueueForSend).not.toHaveBeenCalled();
  });

  it("hides the header gear on the legacy home (no settings concept outside the experiment)", () => {
    // 従来ホームに ⚙ は無い — 「モバイル連携」トグルというデスクトップ語彙を
    // スマホに持ち込まない。実験に入る入口はタイムライン上部のオプトインカード
    renderView({ onUploadMedia: async () => "file-id" });
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    expect(screen.getByTestId("mobile-optin-card")).toBeTruthy();
  });

  it("opens the storage picker from the opt-in card's Try it", () => {
    renderView({ onUploadMedia: async () => "file-id" });

    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    const sheet = screen.getByTestId("storage-picker-sheet");
    expect(sheet).toBeTruthy();
    // Google は利用可 / OneDrive は準備中バッジ + 無効。共有シート行は無い
    const google = screen.getByRole("button", { name: /Google Drive/ });
    expect((google as HTMLButtonElement).disabled).toBe(false);
    const oneDrive = screen.getByRole("button", { name: /OneDrive/ });
    expect((oneDrive as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /share sheet/i })).toBeNull();
    // この時点ではまだ実験に入っていない
    expect(isMobileInboxEnabled()).toBe(false);
  });

  it("joins the experiment when the opt-in Google connect succeeds (home queue-izes in place)", () => {
    // connectGoogle 成功 = 親の onConnected が呼ばれる（フラグ ON + ピッカーを閉じる）
    const connectGoogle = vi.fn(() => {
      lastOnConnected?.();
    });
    usePushSettingsMock.mockReturnValue(pushSettingsUi({ connectGoogle }));
    usePushQueueMock.mockReturnValue(
      pushUi({ items: [queueItem("a", "graphium-20260727-102030-01.jpg")] }),
    );
    renderView({ onUploadMedia: async () => "file-id" });

    fireEvent.click(screen.getByRole("button", { name: "Try it" }));
    fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
    expect(connectGoogle).toHaveBeenCalledTimes(1);

    // フラグが立ち、その場でキュー前提ホームに切り替わる（リロード不要）
    expect(isMobileInboxEnabled()).toBe(true);
    expect(screen.getByText("Send queue")).toBeTruthy();
    expect(screen.queryByTestId("storage-picker-sheet")).toBeNull();
    expect(screen.queryByTestId("mobile-optin-card")).toBeNull();
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
