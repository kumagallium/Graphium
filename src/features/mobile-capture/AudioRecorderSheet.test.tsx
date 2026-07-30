// @vitest-environment jsdom
// 録音ボトムシート（プレゼンテーション層）のテスト。
//
// 対象の不変条件:
// - 状態ごとに主操作が 1 つだけ出る（録音開始 / 停止 / 録れたものの確定）
// - 録り終えるまで捕獲ボタンは現れない（空の音声を送らない）
// - 録音中は背景タップで閉じない（録りかけを取りこぼさない）
// - 失敗は種類ごとに違う文言になる（権限拒否とマイク無しを混ぜない）
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AudioRecorderSheetView, type AudioRecorderSheetViewProps } from "./AudioRecorderSheet";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const baseProps: AudioRecorderSheetViewProps = {
  status: "idle",
  elapsedMs: 0,
  onStart: () => {},
  onStop: () => {},
  onRetake: () => {},
  onCapture: () => {},
  onClose: () => {},
};

function renderSheet(overrides: Partial<AudioRecorderSheetViewProps> = {}) {
  return render(
    <LocaleProvider>
      <AudioRecorderSheetView {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("AudioRecorderSheetView", () => {
  it("offers only Start while idle — nothing to capture yet", () => {
    const onStart = vi.fn();
    renderSheet({ onStart });

    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Capture" })).toBeNull();
    expect(screen.getByTestId("audio-elapsed").textContent).toBe("0:00");
  });

  it("turns the same button into Stop while recording and ticks the elapsed time", () => {
    const onStop = vi.fn();
    renderSheet({ status: "recording", elapsedMs: 65_000, onStop });

    expect(screen.getByTestId("audio-elapsed").textContent).toBe("1:05");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet open when the backdrop is tapped mid-recording", () => {
    const onClose = vi.fn();
    renderSheet({ status: "recording", onClose });

    fireEvent.click(screen.getByTestId("audio-recorder-sheet"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop tap once nothing is being recorded", () => {
    const onClose = vi.fn();
    renderSheet({ onClose });

    fireEvent.click(screen.getByTestId("audio-recorder-sheet"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the button while waiting for microphone permission", () => {
    renderSheet({ status: "requesting" });

    const button = screen.getByTestId("audio-record-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Waiting for microphone access...")).toBeTruthy();
  });

  it("plays back what was recorded and lets it be captured or redone", () => {
    const onCapture = vi.fn();
    const onRetake = vi.fn();
    renderSheet({
      status: "recorded",
      elapsedMs: 12_000,
      previewUrl: "blob:preview",
      onCapture,
      onRetake,
    });

    expect(screen.getByTestId("audio-preview").getAttribute("src")).toBe("blob:preview");
    fireEvent.click(screen.getByRole("button", { name: "Record again" }));
    expect(onRetake).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    expect(onCapture).toHaveBeenCalledTimes(1);
  });

  it("says why it stopped when the 10-minute limit was hit", () => {
    renderSheet({ status: "recorded", elapsedMs: 600_000, previewUrl: "blob:preview", limitReached: true });
    expect(screen.getByText("Stopped at the 10-minute limit.")).toBeTruthy();
  });

  it("tells a blocked microphone apart from a missing one", () => {
    const onStart = vi.fn();
    renderSheet({ status: "error", errorKind: "denied", onStart });
    expect(screen.getByText(/Microphone access is blocked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onStart).toHaveBeenCalledTimes(1);

    cleanup();
    renderSheet({ status: "error", errorKind: "noDevice" });
    expect(screen.getByText("No microphone was found on this device.")).toBeTruthy();
  });
});
