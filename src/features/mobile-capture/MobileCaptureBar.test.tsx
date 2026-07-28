// @vitest-environment jsdom
// 画面下固定・捕獲バー（キュー前提ホーム用）のテスト。
//
// 対象の不変条件:
// - [書く] は常に出る。[URL] は onAddUrl が渡されたときだけ（袋小路を作らない）
// - 撮影 4 ボタン（写真/動画/音声/ライブラリ）+ hidden input は showMediaButtons の
//   間だけ。mediaDisabled で一時無効化できる
// - ピッカーで選んだファイルは onAddFiles に渡り、input は毎回リセットされる
//   （同じものを撮り直し / 選び直しできる）
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MobileCaptureBar, type MobileCaptureBarProps } from "./MobileCaptureBar";
import { LocaleProvider } from "../../i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const baseProps: MobileCaptureBarProps = {
  onComposeMemo: () => {},
  showMediaButtons: true,
  onAddFiles: () => {},
};

function renderBar(overrides: Partial<MobileCaptureBarProps> = {}) {
  return render(
    <LocaleProvider>
      <MobileCaptureBar {...baseProps} {...overrides} />
    </LocaleProvider>,
  );
}

describe("MobileCaptureBar", () => {
  it("shows all six capture buttons with their pickers when every route exists", () => {
    const onComposeMemo = vi.fn();
    const onAddUrl = vi.fn();
    renderBar({ onComposeMemo, onAddUrl });

    for (const name of ["Write", "URL", "Photo", "Video", "Voice", "Library"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Write" }));
    expect(onComposeMemo).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "URL" }));
    expect(onAddUrl).toHaveBeenCalledTimes(1);
    // 撮影入力（iOS の HEIC→JPEG 変換を保つため accept は * のまま）
    expect(screen.getByTestId("capture-bar-photo").getAttribute("accept")).toBe("image/*");
    expect(screen.getByTestId("capture-bar-video")).toBeTruthy();
    expect(screen.getByTestId("capture-bar-audio")).toBeTruthy();
    expect(screen.getByTestId("capture-bar-library")).toBeTruthy();
  });

  it("keeps only the compose buttons when the media route is unavailable", () => {
    renderBar({ showMediaButtons: false, onAddUrl: vi.fn() });

    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "URL" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Photo" })).toBeNull();
    expect(screen.queryByTestId("capture-bar-photo")).toBeNull();
  });

  it("omits the URL button when no handler is given", () => {
    renderBar({ onAddUrl: undefined });
    expect(screen.queryByRole("button", { name: "URL" })).toBeNull();
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
  });

  it("hands picked files to onAddFiles and resets the input", () => {
    const onAddFiles = vi.fn();
    renderBar({ onAddFiles });

    const input = screen.getByTestId("capture-bar-library") as HTMLInputElement;
    const files = [
      new File([new Uint8Array([1]) as BlobPart], "image.jpg", { type: "image/jpeg" }),
      new File([new Uint8Array([2]) as BlobPart], "clip.mov", { type: "video/quicktime" }),
    ];
    fireEvent.change(input, { target: { files } });

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles.mock.calls[0][0]).toHaveLength(2);
    expect(input.value).toBe("");
  });

  it("disables only the media buttons while mediaDisabled", () => {
    renderBar({ mediaDisabled: true, onAddUrl: vi.fn() });

    for (const name of ["Photo", "Video", "Voice", "Library"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole("button", { name: "Write" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "URL" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
