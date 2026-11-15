// @vitest-environment jsdom
// 受信箱の音声の文字起こしの知らせ: 取得中は消えない・完了は消える・知らせは閉じるまで残る・緑のチェックにしない

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider, t } from "../../i18n";
import { InboxTranscribeToast, type InboxTranscribeToastState } from "./InboxTranscribeToast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderToast = (state: InboxTranscribeToastState, onDismiss = () => {}) =>
  render(
    <LocaleProvider>
      <InboxTranscribeToast state={state} onDismiss={onDismiss} />
    </LocaleProvider>,
  );

describe("InboxTranscribeToast", () => {
  beforeEach(() => vi.useFakeTimers());

  it("state が null なら何も出さない", () => {
    const { container } = renderToast(null);
    expect(container.textContent).toBe("");
  });

  it("モデルの取得中は大きさと進み具合・止め方の案内を出し、時間が経っても消えない", () => {
    const { container } = renderToast({ download: { mb: 574, percent: 12 }, modelReady: false, notices: [] });
    expect(container.textContent).toContain(t("mobile.transcribeModelDownloading", { size: "574", percent: "12" }));
    expect(container.textContent).toContain(t("mobile.transcribeModelCancelHint"));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(container.textContent).toContain("574");
    // ナレッジ生成の見出し・停止ボタンは出ない
    expect(screen.queryByText(/ナレッジ生成/)).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("取得が終わった知らせは数秒で消える", () => {
    const { container } = renderToast({ download: null, modelReady: true, notices: [] });
    expect(container.textContent).toContain(t("mobile.transcribeModelDone"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.textContent).toBe("");
  });

  it("文字にできなかった・モデルが無い知らせは自動で消えず、閉じるボタンで消す。緑のチェックにしない", () => {
    const onDismiss = vi.fn();
    const { container } = renderToast(
      {
        download: null,
        modelReady: false,
        notices: [
          { id: "a", text: "音声 2 件は文字起こしできませんでした。音声はそのまま残っています" },
          { id: "m", text: "モデルが使えないため文字起こししていません" },
        ],
      },
      onDismiss,
    );
    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(container.textContent).toContain("音声 2 件は文字起こしできませんでした");
    expect(container.textContent).toContain("モデルが使えないため");
    expect(container.querySelector("svg.text-emerald-600")).toBeNull();
    expect(container.querySelector("[class*='destructive']")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("common.close") }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
