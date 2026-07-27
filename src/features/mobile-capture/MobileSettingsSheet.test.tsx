// @vitest-environment jsdom
// スマホ専用の最小設定シート（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - ストレージ: 未設定 / 未接続 / 接続済み（Google Drive 表記）を出し分け、
//   接続済みのときだけ [切断] が出る。[接続]（未接続）/[変更]（接続済み）は
//   onOpenStoragePicker（ストレージ選択を開くだけ — connect の実体はピッカー側）
// - 詳細（client_id 上書き）は畳まれた保険: 保存/解除が onSaveClientId/onClearClientId
// - 言語: 設定モーダルと同じ setLocale（切替が UI にその場で反映される）
// - アプリ情報: バージョンを getAppVersion から出す（PWA は package.json）
// - この実験をやめる: onLeaveExperiment + 「キューと接続は保持」の説明を添える
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MobileSettingsSheet, type MobileSettingsSheetProps } from "./MobileSettingsSheet";
import { LocaleProvider } from "../../i18n";
import pkg from "../../../package.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const baseProps: MobileSettingsSheetProps = {
  ready: true,
  configured: true,
  connected: false,
  hasBundledId: true,
  clientIdOverride: "",
  onSaveClientId: () => {},
  onClearClientId: () => {},
  onDisconnect: () => {},
  onOpenStoragePicker: () => {},
  onLeaveExperiment: () => {},
  onClose: () => {},
};

function renderSheet(overrides: Partial<MobileSettingsSheetProps> = {}) {
  return render(
    <LocaleProvider>
      <MobileSettingsSheet {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("MobileSettingsSheet", () => {
  it("shows Connect while disconnected and opens the storage picker from it", () => {
    const onOpenStoragePicker = vi.fn();
    renderSheet({ onOpenStoragePicker });

    expect(screen.getByText("Not connected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onOpenStoragePicker).toHaveBeenCalledTimes(1);
  });

  it("shows the connected provider with Change and Disconnect", () => {
    const onOpenStoragePicker = vi.fn();
    const onDisconnect = vi.fn();
    renderSheet({ connected: true, onOpenStoragePicker, onDisconnect });

    expect(screen.getByText(/Google Drive・Connected/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onOpenStoragePicker).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the client_id override folded and wires save/clear", () => {
    const onSaveClientId = vi.fn();
    const onClearClientId = vi.fn();
    renderSheet({
      clientIdOverride: "old-id.apps.googleusercontent.com",
      onSaveClientId,
      onClearClientId,
    });

    // 畳み（details）の中に入力がある — 開いてから操作する
    fireEvent.click(screen.getByText("Advanced"));
    const input = screen.getByPlaceholderText("xxxxxxxx.apps.googleusercontent.com");
    expect((input as HTMLInputElement).value).toBe("old-id.apps.googleusercontent.com");
    fireEvent.change(input, { target: { value: "new-id.apps.googleusercontent.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveClientId).toHaveBeenCalledWith("new-id.apps.googleusercontent.com");
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(onClearClientId).toHaveBeenCalledTimes(1);
  });

  it("switches the language in place via setLocale (same store as the settings modal)", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    // シート自身の文言が即座に日本語へ（localStorage graphium_locale にも永続）
    expect(screen.getByText("この実験をやめる")).toBeTruthy();
    expect(localStorage.getItem("graphium_locale")).toBe("ja");
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Leave this experiment")).toBeTruthy();
  });

  it("shows the app version from the shared updater path", async () => {
    renderSheet();
    // Web（非 Tauri）では package.json の version
    await waitFor(() => expect(screen.getByText(pkg.version)).toBeTruthy());
    expect(screen.getByText("Graphium")).toBeTruthy();
  });

  it("offers leave-experiment with the keep-your-data note", () => {
    const onLeaveExperiment = vi.fn();
    renderSheet({ onLeaveExperiment });

    expect(screen.getByText(/queue and connection stay on this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Leave this experiment" }));
    expect(onLeaveExperiment).toHaveBeenCalledTimes(1);
  });
});
