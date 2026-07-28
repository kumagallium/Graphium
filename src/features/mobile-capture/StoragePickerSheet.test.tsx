// @vitest-environment jsdom
// ストレージ選択ボトムシート（props 駆動のプレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - Google Drive 行は googleReady まで無効（connect() は prepare 済みが前提 —
//   押せる時点で必ずジェスチャ内同期接続できる）。click は onSelectGoogle を
//   **同期的に** 呼ぶ（ハンドラ内に await を挟まない契約の入口）
// - OneDrive 行は常に無効 + 「準備中」バッジ（P1.5 で活性化する枠）
// - 並ぶのは接続するストレージだけ（かつての共有シート行は撤去済み — 出ない）
// - connecting 中は Google 行が無効（スピナー）/ connectError は文言に出る
// - 背景タップ・✕ で onClose
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StoragePickerSheet, type StoragePickerSheetProps } from "./StoragePickerSheet";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const baseProps: StoragePickerSheetProps = {
  googleReady: true,
  connecting: false,
  connectError: null,
  onSelectGoogle: () => {},
  onClose: () => {},
};

function renderSheet(overrides: Partial<StoragePickerSheetProps> = {}) {
  return render(
    <LocaleProvider>
      <StoragePickerSheet {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("StoragePickerSheet", () => {
  it("calls onSelectGoogle synchronously from the Google row click", () => {
    const calls: string[] = [];
    const onSelectGoogle = vi.fn(() => calls.push("google"));
    renderSheet({ onSelectGoogle });

    // fireEvent.click は同期 — 戻った時点で呼ばれていること（await を挟まない配線）
    fireEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
    expect(onSelectGoogle).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["google"]);
  });

  it("disables the Google row until prepare is done (googleReady=false)", () => {
    const onSelectGoogle = vi.fn();
    renderSheet({ googleReady: false, onSelectGoogle });

    const google = screen.getByRole("button", { name: /Google Drive/ });
    expect((google as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(google);
    expect(onSelectGoogle).not.toHaveBeenCalled();
  });

  it("keeps OneDrive disabled with a Coming soon badge (P1.5 slot)", () => {
    renderSheet();
    const oneDrive = screen.getByRole("button", { name: /OneDrive/ });
    expect((oneDrive as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Coming soon")).toBeTruthy();
  });

  it("lists only connectable storage (the old share-sheet row is gone)", () => {
    renderSheet();
    // ピッカーはストレージ選択専用 — 共有シート行は存在しない
    expect(screen.queryByRole("button", { name: /share sheet/i })).toBeNull();
    expect(screen.queryByText(/share sheet/i)).toBeNull();
  });

  it("locks the rows while connecting and surfaces connect errors", () => {
    renderSheet({ connecting: true, connectError: "Popup closed by user" });

    const google = screen.getByRole("button", { name: /Google Drive/ });
    expect((google as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Popup closed by user/)).toBeTruthy();
  });

  it("closes from the backdrop and the close button", () => {
    const onClose = vi.fn();
    renderSheet({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("storage-picker-sheet"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
