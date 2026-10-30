// @vitest-environment jsdom
// MemoPopover（メモの小窓）のテスト。
//
// 対象の不変条件:
// - 見出し（title）と、headerAction・children を出す
// - onCreate があれば書く欄を出し、⏎ で本文を渡す。無ければ書く欄を出さない（読むだけ）
// - メモの項目を押すと onOpenMemo の id を渡し、小窓を閉じる
// - Esc・外側クリックで閉じる。小窓の中・起点の印を押しても外側クリックにならない
// - メモが 0 件なら emptyText を出す
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoPopover } from "./MemoPopover";
import type { CaptureEntry } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は ResizeObserver を持たない（AnchoredPortal は無ければ測り直しを諦めるだけだが、揃えておく）
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

afterEach(cleanup);

const MEMOS: CaptureEntry[] = [
  { id: "m1", text: "SEM 像。粒界に析出物。", createdAt: "2026-10-30T10:00:00.000Z" },
  { id: "m2", text: "撮影条件を確認する。", createdAt: "2026-10-30T09:00:00.000Z" },
];

function setup(props: Partial<React.ComponentProps<typeof MemoPopover>> = {}) {
  const anchor = document.createElement("button");
  anchor.textContent = "chip";
  document.body.appendChild(anchor);
  const onClose = vi.fn();
  const utils = render(
    <LocaleProvider>
      <MemoPopover anchor={anchor} title="sem-900c.png" memos={MEMOS} onClose={onClose} {...props} />
    </LocaleProvider>,
  );
  return { anchor, onClose, ...utils };
}

describe("MemoPopover", () => {
  it("見出し・メモ・headerAction・children を出す", () => {
    setup({
      headerAction: <button aria-label="open-full">full</button>,
      children: <div>status-slot</div>,
    });
    const dialog = screen.getByRole("dialog", { name: "sem-900c.png" });
    expect(dialog).toBeTruthy();
    expect(screen.getByTitle("sem-900c.png").textContent).toBe("sem-900c.png");
    expect(screen.getByText("SEM 像。粒界に析出物。")).toBeTruthy();
    expect(screen.getByText("撮影条件を確認する。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "open-full" })).toBeTruthy();
    expect(screen.getByText("status-slot")).toBeTruthy();
  });

  it("onCreate が無ければ書く欄を出さない（読むだけ）", () => {
    setup();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("onCreate があれば書く欄を出し、⏎ で本文を渡す", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    setup({ onCreate, placeholder: "ここに書く" });
    const box = screen.getByPlaceholderText("ここに書く");
    fireEvent.change(box, { target: { value: "新しいメモ" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("新しいメモ"));
  });

  it("項目を押すと onOpenMemo に id を渡し、小窓を閉じる", () => {
    const onOpenMemo = vi.fn();
    const { onClose } = setup({ onOpenMemo });
    fireEvent.click(screen.getByText("撮影条件を確認する。"));
    expect(onOpenMemo).toHaveBeenCalledWith("m2");
    expect(onClose).toHaveBeenCalled();
  });

  it("小窓には削除ボタンを出さない", () => {
    setup({ onOpenMemo: () => {} });
    expect(screen.queryByRole("button", { name: "Delete memo" })).toBeNull();
  });

  it("Esc で閉じる", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("外側クリックで閉じる。小窓の中・起点の印のクリックでは閉じない", () => {
    const { onClose, anchor } = setup();
    fireEvent.mouseDown(screen.getByText("SEM 像。粒界に析出物。"));
    fireEvent.mouseDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("メモが 0 件なら emptyText を出す", () => {
    setup({ memos: [], emptyText: "まだメモはありません" });
    expect(screen.getByText("まだメモはありません")).toBeTruthy();
  });
});
