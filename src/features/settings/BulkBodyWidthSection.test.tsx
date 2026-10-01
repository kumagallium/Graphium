// @vitest-environment jsdom
// 設定「これまでのノートも A4 にする / A4 のノートをすべて標準に戻す」の 2 つのボタン。
// 押すと確認 → 実行中は進み具合と「止める」→ 終わったら結果を 1 行。文言は既定の en で照合する。

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { BulkBodyWidthSection } from "./BulkBodyWidthSection";
import type { BulkWidthProgress, BulkWidthResult } from "../paper-mode/bulk-body-width";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RESULT: BulkWidthResult = {
  total: 300,
  changed: 280,
  skippedFullWidth: 12,
  skippedAlready: 8,
  skippedOther: 0,
  failed: 0,
  failedIds: [],
  aborted: false,
};

function renderSection(run: Parameters<typeof BulkBodyWidthSection>[0]["run"], count = 300) {
  return render(
    <LocaleProvider>
      <BulkBodyWidthSection countTargets={() => count} run={run} />
    </LocaleProvider>,
  );
}

describe("BulkBodyWidthSection", () => {
  it("確認で取り消せば何も実行しない。確認の文に対象の件数が入る", () => {
    const run = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderSection(run);

    fireEvent.click(screen.getByRole("button", { name: "Also switch existing notes to A4" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("300");
    expect(run).not.toHaveBeenCalled();
  });

  it("A4 にする: 進み具合を出し、終わったら結果を 1 行で出す", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let finish!: (r: BulkWidthResult) => void;
    let report!: (p: BulkWidthProgress) => void;
    const run = vi.fn((_mode, opts: { onProgress: (p: BulkWidthProgress) => void }) => {
      report = opts.onProgress;
      return new Promise<BulkWidthResult>((resolve) => {
        finish = resolve;
      });
    });
    renderSection(run);

    fireEvent.click(screen.getByRole("button", { name: "Also switch existing notes to A4" }));
    expect(run.mock.calls[0][0]).toBe("a4");
    act(() => report({ done: 120, total: 300 }));
    expect(screen.getByText("120 / 300 notes")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();

    await act(async () => finish(RESULT));
    expect(
      screen.getByText("Switched to A4: 280 (left as is because full width: 12, already A4: 8)"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });

  it("標準に戻す: モードが standard で渡る", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const run = vi.fn(async (_mode: string) => ({ ...RESULT, changed: 5, skippedOther: 295 }));
    renderSection(run);

    fireEvent.click(screen.getByRole("button", { name: "Switch all A4 notes back to standard" }));

    await waitFor(() => expect(screen.getByText("Switched back to standard: 5 (not on A4: 295)")).toBeTruthy());
    expect(run.mock.calls[0][0]).toBe("standard");
  });

  it("止めるを押すと signal が止まる。止めた旨と、失敗した件数・続きから直せる旨を出す", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let signal!: AbortSignal;
    let finish!: (r: BulkWidthResult) => void;
    const run = vi.fn((_mode, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise<BulkWidthResult>((resolve) => {
        finish = resolve;
      });
    });
    renderSection(run);

    fireEvent.click(screen.getByRole("button", { name: "Also switch existing notes to A4" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(signal.aborted).toBe(true);

    await act(async () => finish({ ...RESULT, changed: 10, aborted: true, failed: 2, failedIds: ["a", "b"] }));
    expect(screen.getByText(/Stopped partway\./)).toBeTruthy();
    expect(screen.getByText(/2 note\(s\) could not be updated\. Press the button again/)).toBeTruthy();
  });

  it("対象が 0 件ならボタンは押せない", () => {
    renderSection(vi.fn(), 0);
    expect((screen.getByRole("button", { name: "Also switch existing notes to A4" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("実行中は 2 つのボタンとも押せない。閉じたら（アンマウント）止める", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let signal!: AbortSignal;
    const run = vi.fn((_mode, opts: { signal: AbortSignal }) => {
      signal = opts.signal;
      return new Promise<BulkWidthResult>(() => {});
    });
    const view = renderSection(run);

    fireEvent.click(screen.getByRole("button", { name: "Also switch existing notes to A4" }));
    expect((screen.getByRole("button", { name: "Switch all A4 notes back to standard" }) as HTMLButtonElement).disabled).toBe(true);

    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
