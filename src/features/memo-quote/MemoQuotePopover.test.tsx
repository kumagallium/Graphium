// @vitest-environment jsdom
// MemoQuotePopover（引用したメモの小窓）のテスト。
//
// 対象の不変条件:
// - 元のメモの今の本文と、引用した日時を出す。書く欄は出さない
// - updated: 「元のメモが更新されています」＋「本文に反映」。反映すると onReflect を呼び、小窓を閉じる
// - deleted: 「元のメモは削除されました」。メモの本文は出さず、「メモを開く」も出さない
// - 「メモを開く」は元のメモの id を渡す。「紐づけを外す」は onUnlink
// - editable=false（アーカイブ・ゴミ箱）では「本文に反映」「紐づけを外す」を出さない
// 文言は LocaleProvider の既定（jsdom → en）で照合する。

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoQuotePopover } from "./MemoQuotePopover";
import type { CaptureEntry } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;

afterEach(cleanup);

const MEMO: CaptureEntry = { id: "cap_1", text: "粒界に析出物が見える", createdAt: "2026-10-30T10:00:00.000Z" };
const REF = { captureId: "cap_1", quotedAt: "2026-10-30T11:00:00.000Z", quotedText: "粒界に析出物" };

function setup(props: Partial<React.ComponentProps<typeof MemoQuotePopover>> = {}) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const handlers = { onOpenMemo: vi.fn(), onReflect: vi.fn(), onUnlink: vi.fn(), onClose: vi.fn() };
  render(
    <LocaleProvider>
      <MemoQuotePopover
        anchor={anchor}
        quoteRef={REF}
        status="synced"
        memo={MEMO}
        editable
        {...handlers}
        {...props}
      />
    </LocaleProvider>,
  );
  return handlers;
}

describe("MemoQuotePopover", () => {
  it("synced: 元のメモの本文と引用日時を出し、書く欄と更新の案内は出さない", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Quoted memo" })).toBeTruthy();
    expect(screen.getByText("粒界に析出物が見える")).toBeTruthy();
    expect(screen.getByText(/^Quoted \d/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("The original memo has been updated")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update this quote" })).toBeNull();
  });

  it("updated: 更新の案内と「本文に反映」。押すと onReflect を呼んで閉じる", () => {
    const h = setup({ status: "updated" });
    expect(screen.getByText("The original memo has been updated")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update this quote" }));
    expect(h.onReflect).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("deleted: 削除の案内を出し、メモの本文・「メモを開く」は出さない。紐づけは外せる", () => {
    const h = setup({ status: "deleted", memo: undefined });
    expect(screen.getByText("The original memo was deleted")).toBeTruthy();
    expect(screen.getByText("The text in this quote stays as it is")).toBeTruthy();
    expect(screen.queryByText("粒界に析出物が見える")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open memo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Detach from memo" }));
    expect(h.onUnlink).toHaveBeenCalledTimes(1);
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("「メモを開く」は元のメモの id を渡して閉じる", () => {
    const h = setup();
    fireEvent.click(screen.getByRole("button", { name: "Open memo" }));
    expect(h.onOpenMemo).toHaveBeenCalledWith("cap_1");
    expect(h.onClose).toHaveBeenCalled();
  });

  it("editable=false: 「本文に反映」「紐づけを外す」を出さない（読むことと開くことはできる）", () => {
    setup({ status: "updated", editable: false });
    expect(screen.queryByRole("button", { name: "Update this quote" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Detach from memo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open memo" })).toBeTruthy();
    expect(screen.getByText("The original memo has been updated")).toBeTruthy();
  });
});
