// @vitest-environment jsdom
// モバイルキャプチャビュー（捕獲の時系列ホーム）の配線テスト。
//
// 対象の不変条件:
// - 捕獲履歴の統合リストがコンテンツ最上部にインラインで出る（[送信 (n)] は見出し行
//   右端の定位置）。捕獲ボタンは画面下固定の捕獲バー
//   （[書く][URL][写真][動画][音声][ライブラリ]）— リストより後（下）に出る。
//   撮ったファイルは enqueueForSend に渡り、シートは開かない（SendToInboxSheet 自体が
//   存在しない。この端末には保存しない — 完全置き換え）
// - メモ・URL も捕獲物として履歴行き（ネイティブ JSON）。ローカルの capture-store /
//   media-index には保存しない
// - 統合リストは捕獲履歴（送信済みを含む）と、この端末に残る過去のメモ・素材を
//   時刻で混ぜて新しい順に出す。**過去にローカル保存した分もここに出る**ので、
//   従来ホーム（2 カラムのカードグリッド）を撤去してもデータは見えなくならない
// - 検索欄は統合リスト全体（履歴 + ローカル項目）に掛かる
// - 履歴もローカル項目も無いときだけ空状態になり、下の捕獲バーだけが残る
// - client_id 未設定でも捕獲物は履歴に積まれる（履歴はこの端末の IndexedDB で
//   動く。未設定の案内は送信段階 = CaptureHistorySection が出す）。enqueueForSend が
//   false（IndexedDB 不可 = キュー自体が使えない）のときだけ従来のローカル保存
//   （メディア=onUploadMedia / メモ=onCreateCapture / URL=onAddUrlBookmark）に落ちる
// - キュー経路が使える環境では、onUploadMedia が無くても撮影ボタンが出る
//   （configured ではゲートしない — 設計 doc §13.9）
// - ヘッダーの接続状態チップは 接続済み / 未接続 / 未設定 を出し分ける
// - スマホにフル設定モーダルは出さない: ヘッダー ⚙ は最小設定シート
//   （MobileSettingsSheet）を開き、`graphium-open-settings` は飛ばさない。
//   未接続時の主ボタンはストレージ選択（StoragePickerSheet）を開き、Google 行が
//   接続の実体（connectAndDrain）につながる
// - 実験フラグ撤去後の回帰防止: オプトインカード・従来の 2 カラムグリッド・
//   従来の [New Memo] 下バー・実験離脱ボタンはもう存在しない（常に捕獲履歴ホーム）
//
// usePushQueue / usePushSettings はモック（キュー・認可の実物は hook 側の責務）。

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MobileCaptureView } from "./MobileCaptureView";
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

// 最小設定シートのストレージ操作（状態・切断・client_id）もモック。
const usePushSettingsMock = vi.fn<() => PushSettingsUi>();

vi.mock("./inbox/use-push-settings", () => ({
  usePushSettings: (_active: boolean) => usePushSettingsMock(),
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
    getItemThumbnail: vi.fn(async () => null),
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
    disconnect: vi.fn(),
    saveClientId: vi.fn(),
    clearClientId: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  usePushQueueMock.mockReturnValue(pushUi());
  usePushSettingsMock.mockReturnValue(pushSettingsUi());
  localStorage.clear();
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

describe("捕獲履歴ホーム", () => {
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
    expect(screen.getByText("Captures")).toBeTruthy();
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
    expect(screen.queryByTestId("capture-history-block")).toBeNull();
  });

  it("collapses the queue section while empty, keeping the bottom capture bar", () => {
    renderView();

    expect(screen.queryByTestId("capture-history-block")).toBeNull();
    expect(screen.queryByText("Captures")).toBeNull();
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
    // 捕獲バーは残る
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Photo" })).toBeTruthy();
  });

  it("merges the capture history and this device's older items into one timeline", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          queueItem("a", "graphium-20260727-102030-01.jpg"), // 07-27 10:20 待機
          {
            ...queueItem("s", "graphium-20260726-080000-01.jpg"),
            enqueuedAt: "2026-07-26T08:00:00.000Z",
            sentAt: "2026-07-26T08:00:20.000Z",
            status: "sent",
          },
        ],
      }),
    );
    renderView({
      captureIndex: {
        version: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
        captures: [
          { id: "m1", text: "timeline memo", createdAt: "2026-07-27T09:00:00.000Z" },
        ],
      },
      mediaIndex: {
        version: 4,
        updatedAt: "2026-07-27T00:00:00.000Z",
        media: [
          {
            fileId: "f1",
            name: "whiteboard.jpg",
            type: "image",
            mimeType: "image/jpeg",
            url: "https://example.com/f1",
            thumbnailUrl: "https://example.com/f1-thumb",
            uploadedAt: "2026-07-25T12:00:00.000Z",
            usedIn: [],
          },
        ],
      },
    });

    // 1 本のリストに時系列（新しい順）で混ざる: 待機(07-27 10:20) → メモ(07-27 09:00)
    // → 送信済み(07-26) → 素材(07-25)。送信済みも消えない
    const states = Array.from(
      document.querySelectorAll("[data-testid=capture-history-row]"),
    ).map((row) => row.getAttribute("data-status"));
    expect(states).toEqual(["pending", "local", "sent", "local"]);
    expect(screen.getByText("timeline memo")).toBeTruthy();
    expect(screen.getByText("whiteboard.jpg")).toBeTruthy();
    expect(screen.getByText("Sent")).toBeTruthy();
    // 2 カラムのカードグリッド（撤去した従来ホーム）は復活しない
    expect(document.querySelector(".grid-cols-2")).toBeNull();
    // メモ作成は捕獲バーの [書く]（従来のメモ作成ボタンは無い）
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /New Memo/ })).toBeNull();
  });

  it("filters the whole merged list from the search box", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          queueItem("a", "graphium-20260727-102030-01.jpg"),
          {
            ...queueItem("m", "graphium-20260727-102030-02-memo.graphium.json"),
            mime: "application/vnd.graphium.capture+json",
            preview: "hypothesis about grain size",
          },
        ],
      }),
    );
    renderView({
      captureIndex: {
        version: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
        captures: [
          { id: "m1", text: "timeline memo", createdAt: "2026-07-27T09:00:00.000Z" },
          { id: "m2", text: "hypothesis notes", createdAt: "2026-07-27T08:00:00.000Z" },
        ],
      },
    });

    fireEvent.change(screen.getByPlaceholderText(/Search/i), {
      target: { value: "hypothesis" },
    });

    // 履歴側（preview 一致）とローカル側（本文一致）の両方が残る
    expect(screen.getByText("hypothesis about grain size")).toBeTruthy();
    expect(screen.getByText("hypothesis notes")).toBeTruthy();
    expect(screen.queryByText("timeline memo")).toBeNull();
    expect(screen.queryByText("graphium-20260727-102030-01.jpg")).toBeNull();
  });

  it("shows the empty state only when neither history nor local items remain", () => {
    // 送信済みだけでも「空」にはしない（撮った手応えが残る）
    usePushQueueMock.mockReturnValue(
      pushUi({
        items: [
          {
            ...queueItem("s", "graphium-20260726-080000-01.jpg"),
            status: "sent",
            sentAt: "2026-07-26T08:00:20.000Z",
          },
        ],
      }),
    );
    const view = renderView();
    expect(screen.queryByText(/No past captures yet/)).toBeNull();
    view.unmount();

    usePushQueueMock.mockReturnValue(pushUi({ items: [] }));
    renderView();
    expect(screen.getByText(/No past captures yet/)).toBeTruthy();
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

  it("falls back to the local capture store for memos when the queue itself is unusable", async () => {
    // enqueue false = IndexedDB 不可（キュー自体が使えない）。client_id 未設定は
    // もう false にならない（未設定でも積まれる — 下の configured:false テスト参照）
    const enqueueForSend = vi.fn(async () => false);
    const onCreateCapture = vi.fn(async () => {});
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
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

  it("falls back to local save only when the queue itself is unusable", async () => {
    // enqueue false = IndexedDB 不可の非常口（データを落とさない）
    const enqueueForSend = vi.fn(async () => false);
    const onUploadMedia = vi.fn(async () => "file-id");
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onUploadMedia });

    capture("image/*", [jpeg()]);

    await waitFor(() => expect(onUploadMedia).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("capture-history-block")).toBeNull();
  });

  it("shows capture buttons without onUploadMedia when the queue route works", () => {
    renderView({ onUploadMedia: undefined });
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="video/*"]')).toBeTruthy();
    expect(document.querySelector('input[accept="audio/*"]')).toBeTruthy();
  });

  it("keeps the capture buttons when no client_id is configured — captures go to the queue, guidance at send time", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({
        configured: false,
        items: [queueItem("a", "graphium-20260727-102030-01.jpg")],
      }),
    );
    renderView({ onUploadMedia: undefined });

    // 未設定でも撮影ボタンは出る — キューはこの端末の IndexedDB で動くので撮った物は
    // キューに積まれ、袋小路（この端末のローカル保存）には落ちない（設計 doc §13.9）
    expect(document.querySelector('input[accept="image/*"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    // 送り残し・積んだ物は見え、未設定の案内 + 設定導線は送信段階（キュー側）が出す
    expect(screen.getByText("graphium-20260727-102030-01.jpg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Send \(/ })).toBeNull();
  });

  it("hides the media capture buttons only while the queue module is not ready and no local save exists", () => {
    // push モジュールのロード前（ready=false）だけは経路の実在が未確定なので、
    // onUploadMedia も無ければ撮影ボタンを出さない（一瞬の過渡状態）
    usePushQueueMock.mockReturnValue(pushUi({ ready: false, configured: false }));
    renderView({ onUploadMedia: undefined });

    expect(document.querySelector('input[accept="image/*"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
    // [書く] は退路（ローカル capture-store）があるので残る
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
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
      // スマホ専用の最小設定シート（ストレージ / 言語 / アプリ情報）
      expect(screen.getByTestId("mobile-settings-sheet")).toBeTruthy();
      expect(screen.getByText("Language")).toBeTruthy();
      // 実験離脱の導線はもう無い（降りる先の従来ホームが存在しない）
      expect(screen.queryByText("Leave this experiment")).toBeNull();
      // フル設定モーダルを開くイベントは飛ばさない
      expect(events).toHaveLength(0);
    } finally {
      window.removeEventListener("graphium-open-settings", listener);
    }
  });

  it("wires disconnect in the sheet", () => {
    const disconnect = vi.fn();
    usePushSettingsMock.mockReturnValue(pushSettingsUi({ connected: true, disconnect }));
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    // シートは開いたまま（切断してもホームの作りは変わらない）
    expect(screen.getByTestId("mobile-settings-sheet")).toBeTruthy();
  });
});

// 実験フラグ撤去（捕獲履歴ホームへの昇格）の回帰防止。
// かつてフラグ OFF の「従来ホーム」が担っていた 4 つのこと — メモ作成 / URL 登録 /
// 撮影 / タイムライン閲覧 — が、フラグ無しの捕獲履歴ホーム 1 本で全部できること、
// そして撤去した UI（オプトインカード・2 カラムグリッド・[New Memo] 下バー）が
// 復活していないことを固定する。
describe("実験フラグ撤去後の昇格（唯一のモバイル体験）", () => {
  it("starts on the capture-history home with no opt-in card and no legacy grid", () => {
    usePushQueueMock.mockReturnValue(
      pushUi({ items: [queueItem("a", "graphium-20260727-102030-01.jpg")] }),
    );
    // localStorage は空 = 「これまでフラグ OFF だった既存ユーザー」の初回起動相当
    renderView({ onUploadMedia: async () => "file-id" });

    // 最初から捕獲履歴 + 捕獲バー
    expect(screen.getByTestId("capture-history-block")).toBeTruthy();
    expect(screen.getByText("Captures")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send \(1\)/ })).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();

    // 撤去した従来ホームの部品は出ない
    expect(screen.queryByTestId("mobile-optin-card")).toBeNull();
    expect(screen.queryByText("Try it")).toBeNull();
    expect(document.querySelector(".grid-cols-2")).toBeNull();
    expect(screen.queryByRole("button", { name: /New Memo/ })).toBeNull();
  });

  it("keeps every legacy-home capability on the capture bar (memo / URL / photo / video / audio)", () => {
    renderView({ onUploadMedia: async () => "file-id", onAddUrlBookmark: () => {} });

    // 従来ホームの下バー（メモ + 🔗 + 📷🎥🎙）に対応する捕獲バーのボタン。
    // ライブラリ（既存ファイル選択）は従来ホームには無かった純増分。
    for (const name of ["Write", "URL", "Photo", "Video", "Voice", "Library"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // 撮影入力（accept + capture）も従来ホームと同じ 3 種が揃う
    for (const accept of ["image/*", "video/*", "audio/*"]) {
      expect(document.querySelector(`input[accept="${accept}"]`)).toBeTruthy();
    }
  });

  it("still shows this device's older memos and assets — the merged list carries them", () => {
    // 撤去の前提条件: 従来ホームのグリッドが見せていた過去の捕獲物が
    // localItems として履歴リストに出る（= 古いデータが見えなくならない）
    usePushQueueMock.mockReturnValue(pushUi({ items: [] }));
    renderView({
      captureIndex: {
        version: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
        captures: [
          { id: "m1", text: "memo from the legacy home", createdAt: "2026-07-20T09:00:00.000Z" },
        ],
      },
      mediaIndex: {
        version: 4,
        updatedAt: "2026-07-27T00:00:00.000Z",
        media: [
          {
            fileId: "f1",
            name: "legacy-whiteboard.jpg",
            type: "image",
            mimeType: "image/jpeg",
            url: "https://example.com/f1",
            thumbnailUrl: "https://example.com/f1-thumb",
            uploadedAt: "2026-07-19T12:00:00.000Z",
            usedIn: [],
          },
        ],
      },
    });

    expect(screen.getByText("memo from the legacy home")).toBeTruthy();
    expect(screen.getByText("legacy-whiteboard.jpg")).toBeTruthy();
    // 履歴が空でも過去のローカル項目があるなら空状態にしない
    expect(screen.queryByText(/No past captures yet/)).toBeNull();
    const states = Array.from(
      document.querySelectorAll("[data-testid=capture-history-row]"),
    ).map((row) => row.getAttribute("data-status"));
    expect(states).toEqual(["local", "local"]);
  });

  it("opens the legacy memo/asset detail from a merged-list row (edit + delete still reachable)", async () => {
    const onDeleteCapture = vi.fn(async () => {});
    usePushQueueMock.mockReturnValue(pushUi({ items: [] }));
    renderView({
      onDeleteCapture,
      onEditCapture: () => {},
      captureIndex: {
        version: 1,
        updatedAt: "2026-07-27T00:00:00.000Z",
        captures: [
          { id: "m1", text: "memo from the legacy home", createdAt: "2026-07-20T09:00:00.000Z" },
        ],
      },
    });

    fireEvent.click(screen.getByText("memo from the legacy home"));
    // 従来ホームのカードタップと同じ詳細モーダル（編集導線 + 削除）
    expect(await screen.findByText(/Click to edit/i)).toBeTruthy();
    const del = screen
      .getAllByRole("button")
      .find((b) => b.querySelector('svg[class*="trash"]'));
    expect(del).toBeTruthy();
    fireEvent.click(del!);
    expect(onDeleteCapture).toHaveBeenCalledWith("m1");
  });

  it("works on the web build too: sending is not gated on Tauri", async () => {
    // モバイルからの送信は web/desktop どちらでも使える（受信箱だけが Tauri 専用）。
    // このビューは isTauri() を一切見ないので、__TAURI__ 不在でも捕獲経路は生きる
    expect((window as unknown as Record<string, unknown>).__TAURI__).toBeUndefined();
    const enqueueForSend = vi.fn(async () => true);
    usePushQueueMock.mockReturnValue(pushUi({ enqueueForSend }));
    renderView({ onUploadMedia: undefined });

    capture("image/*", [jpeg()]);
    await waitFor(() => expect(enqueueForSend).toHaveBeenCalledTimes(1));
  });
});
