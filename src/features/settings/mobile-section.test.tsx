// @vitest-environment jsdom
// 設定 › ストレージ の「モバイル送信」セクションのテスト。
//
// このセクションの役割はデスクトップ = **受け取り側**であることの表現:
// - 受信フォルダ（<root>/Inbox/ の親）を共有フォルダと同じ作法で指定できる
// - 「処理済みを _imported/ に残す」を切り替えられる（受信箱ビューと同じ localStorage）
// - 接続/切断ボタンは無い（回帰防止）。トークンは端末ごとの localStorage なので
//   デスクトップで接続してもスマホには効かず、しかも GIS の認可は window.open を
//   使うため Tauri の WebView では必ず "Failed to open popup window" になる
// - 代わりにスマホで開くための QR が出る
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { getInboxKeepArchive, setInboxRoot } from "../mobile-capture/inbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 設定モーダルの import 連鎖（→ markdown-export → media-preview → PdfViewer）対策。
// react-pdf は import しただけで pdfjs が DOMMatrix を触り jsdom では落ちる
// （MobileCaptureView.test.tsx / InboxView.test.tsx と同じ）。
vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {} as Record<string, unknown> },
  Document: () => null,
  Page: () => null,
}));

// フォルダピッカーは Tauri のダイアログ。選択結果だけを差し替える。
const pickInboxRootMock = vi.fn<() => Promise<string | null>>();
vi.mock("../../lib/storage/shared", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../lib/storage/shared");
  return { ...actual, pickInboxRoot: () => pickInboxRootMock() };
});

// 設定モーダルは開いた瞬間にモデル一覧などを引く。ネットワークは黙らせる。
beforeEach(() => {
  localStorage.clear();
  (window as unknown as Record<string, unknown>).__TAURI__ = {};
  // 実験フラグ ON でないとモバイル送信セクションごと出ない
  localStorage.setItem("graphium-experimental-mobile-inbox", "1");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [], default: null }),
      text: async () => "{}",
    }),
  );
  pickInboxRootMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).__TAURI__;
  localStorage.clear();
});

async function renderStorageTab() {
  const { SettingsModal } = await import("./modal");
  const result = render(
    <LocaleProvider>
      <SettingsModal isOpen onClose={() => {}} initialTab="storage" />
    </LocaleProvider>,
  );
  await screen.findByText("Mobile upload");
  return result;
}

describe("Settings › Storage — mobile upload section", () => {
  it("has no connect/disconnect button (connecting is the phone's job)", async () => {
    await renderStorageTab();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    // 端末ごとの client_id 上書きもここには置かない（スマホの設定シートにある）
    expect(screen.queryByText("Google OAuth client ID")).toBeNull();
  });

  it("guides the user to connect on the phone and shows a locally rendered QR", async () => {
    await renderStorageTab();
    expect(screen.getByText("Connect on your phone")).toBeTruthy();
    expect(screen.getByTestId("mobile-connect-qr-code").querySelector("svg")).toBeTruthy();
    expect(screen.getByTestId("mobile-connect-qr-url").textContent).toContain("app/");
  });

  it("picks the inbox folder the same way shared storage does", async () => {
    pickInboxRootMock.mockResolvedValue("/Users/me/Google Drive/Graphium");
    await renderStorageTab();
    expect(screen.getByText("Inbox folder")).toBeTruthy();

    // 共有フォルダと同じラベル（settings.shared.pick）を使う = 同じ作法
    const pickButtons = screen.getAllByRole("button", { name: "Choose folder" });
    const pickButton = pickButtons[pickButtons.length - 1];
    fireEvent.click(pickButton);
    await waitFor(() =>
      expect(screen.getByText("/Users/me/Google Drive/Graphium")).toBeTruthy(),
    );
    expect(localStorage.getItem("graphium-inbox-root")).toBe("/Users/me/Google Drive/Graphium");
  });

  it("reflects a folder chosen elsewhere (inbox view) without a reload", async () => {
    await renderStorageTab();
    setInboxRoot("/from/inbox/view");
    await waitFor(() => expect(screen.getByText("/from/inbox/view")).toBeTruthy());
  });

  it("toggles keep-archive, writing the same setting the inbox view reads", async () => {
    await renderStorageTab();
    const toggle = screen.getByRole("checkbox", {
      name: /Keep processed files/,
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(getInboxKeepArchive()).toBe(true));
  });
});
