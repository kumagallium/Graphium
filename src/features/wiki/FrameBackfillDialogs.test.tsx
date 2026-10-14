// @vitest-environment jsdom
// 補完ダイアログの Esc・aria・中止表示の確認
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { FrameBackfillConfirmDialog, FrameBackfillResultDialog } from "./FrameBackfillDialogs";

const summary = { done: [], skipped: [], failed: [], droppedFrames: 0, truncatedSources: [] };

describe("FrameBackfillDialogs", () => {
  it("確認ダイアログは role=dialog で Esc で閉じる", () => {
    const onCancel = vi.fn();
    render(
      <LocaleProvider>
        <FrameBackfillConfirmDialog count={3} onStart={() => {}} onCancel={onCancel} />
      </LocaleProvider>,
    );
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
  it("結果ダイアログは中止時に未処理件数を出す", () => {
    const onClose = vi.fn();
    const { container } = render(
      <LocaleProvider>
        <FrameBackfillResultDialog
          result={{ summary: { ...summary, aborted: true }, truncatedSources: [], unprocessed: 9 }}
          onClose={onClose}
        />
      </LocaleProvider>,
    );
    expect(container.textContent).toContain("9");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
