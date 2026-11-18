// @vitest-environment jsdom
// 設定の「画像の文字を読むモデル」: 状態の遷移（進捗 → 取得済み・エラー表示・削除）とスイッチの保存

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";

type Cb = (e: any) => void;
const h = vi.hoisted(() => ({
  listeners: {} as Record<string, (e: any) => void>,
  getOcrModelStatus: vi.fn(),
  downloadOcrModel: vi.fn(),
  cancelOcrModelDownload: vi.fn(),
  deleteOcrModel: vi.fn(),
}));

vi.mock("../../lib/ocr-native", () => {
  const on = (name: string) => async (cb: Cb) => {
    h.listeners[name] = cb;
    return () => {};
  };
  return {
    getOcrModelStatus: h.getOcrModelStatus,
    downloadOcrModel: h.downloadOcrModel,
    cancelOcrModelDownload: h.cancelOcrModelDownload,
    deleteOcrModel: h.deleteOcrModel,
    onOcrModelProgress: on("progress"),
    onOcrModelDone: on("done"),
    onOcrModelCancelled: on("cancelled"),
    onOcrModelError: on("error"),
  };
});

import { OcrModelSettingsSection } from "./OcrModelSettingsSection";
import { loadSettings } from "../settings/store";

const st = (present: boolean) => ({ name: "pp-ocrv6-small", present, bytes: present ? 31_000_000 : 0, expectedBytes: 31_000_000 });

const renderSection = () =>
  render(
    <LocaleProvider>
      <OcrModelSettingsSection defaultOpen />
    </LocaleProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  h.listeners = {};
  h.getOcrModelStatus.mockReset().mockResolvedValue(st(false));
  h.downloadOcrModel.mockReset().mockResolvedValue(undefined);
  h.cancelOcrModelDownload.mockReset().mockResolvedValue(undefined);
  h.deleteOcrModel.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

describe("OcrModelSettingsSection", () => {
  it("未取得 → 取得を押すと取得中になり、進捗イベントで %、done で取得済みになる", async () => {
    renderSection();
    await screen.findByText(t("settings.ocrModel.absent"));
    h.getOcrModelStatus.mockResolvedValue(st(true));
    fireEvent.click(screen.getByText(t("settings.ocrModel.download")));
    expect(h.downloadOcrModel).toHaveBeenCalledTimes(1);

    await waitFor(() => expect(h.listeners.progress).toBeDefined());
    act(() => h.listeners.progress({ name: "pp-ocrv6-small", received: 15_500_000, total: 31_000_000 }));
    expect(screen.getByText(t("settings.ocrModel.downloading", { percent: "50" }))).toBeTruthy();
    expect(screen.getByText(t("settings.ocrModel.cancel"))).toBeTruthy();

    act(() => h.listeners.done({ name: "pp-ocrv6-small" }));
    await screen.findByText(t("settings.ocrModel.present", { size: "31" }));
    expect(screen.getByText(t("settings.ocrModel.delete"))).toBeTruthy();
  });

  it("取得に失敗したらメッセージを出し、未取得の表示に戻る", async () => {
    renderSection();
    await screen.findByText(t("settings.ocrModel.absent"));
    fireEvent.click(screen.getByText(t("settings.ocrModel.download")));
    await waitFor(() => expect(h.listeners.error).toBeDefined());
    act(() => h.listeners.error({ name: "pp-ocrv6-small", message: "HTTP 503" }));
    expect(await screen.findByText(t("settings.ocrModel.error", { message: "HTTP 503" }))).toBeTruthy();
    expect(screen.getByText(t("settings.ocrModel.download"))).toBeTruthy();
  });

  it("invoke が失敗しても同じメッセージ欄に出る", async () => {
    h.downloadOcrModel.mockRejectedValue("network down");
    renderSection();
    await screen.findByText(t("settings.ocrModel.absent"));
    fireEvent.click(screen.getByText(t("settings.ocrModel.download")));
    expect(await screen.findByText(t("settings.ocrModel.error", { message: "network down" }))).toBeTruthy();
  });

  it("取得済み → 削除で ocr_model_delete を呼び、未取得に戻る", async () => {
    h.getOcrModelStatus.mockResolvedValue(st(true));
    renderSection();
    await screen.findByText(t("settings.ocrModel.present", { size: "31" }));
    h.getOcrModelStatus.mockResolvedValue(st(false));
    fireEvent.click(screen.getByText(t("settings.ocrModel.delete")));
    expect(h.deleteOcrModel).toHaveBeenCalledTimes(1);
    await screen.findByText(t("settings.ocrModel.absent"));
  });

  it("取得中の取り消しで ocr_model_cancel を呼ぶ", async () => {
    renderSection();
    await screen.findByText(t("settings.ocrModel.absent"));
    fireEvent.click(screen.getByText(t("settings.ocrModel.download")));
    fireEvent.click(await screen.findByText(t("settings.ocrModel.cancel")));
    expect(h.cancelOcrModelDownload).toHaveBeenCalledTimes(1);
  });

  it("スイッチは既定オン。オフにすると設定に false が残り、オンに戻すとキーごと消える", async () => {
    renderSection();
    await screen.findByText(t("settings.ocrModel.absent"));
    const sw = screen.getByRole("switch", { name: t("settings.ocrModel.toggle") });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(loadSettings().ocrNativeEnabled).toBeUndefined();

    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(loadSettings().ocrNativeEnabled).toBe(false);

    fireEvent.click(sw);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect("ocrNativeEnabled" in loadSettings()).toBe(false);
  });
});
