// @vitest-environment jsdom
// MemoList（メモの一覧）と splitMemoBody のテスト。
//
// 対象の不変条件:
// - 本文と出典（最後の「\n\n— 」以降）を分けて表示する
// - 削除ボタンは onDeleteMemo があるときだけ、項目の押下は onOpenMemo があるときだけ
// - 0 件は emptyContent を出す（無ければ何も出さない）

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoList, splitMemoBody } from "./MemoList";
import type { CaptureEntry } from "../mobile-capture";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

const MEMOS: CaptureEntry[] = [
  { id: "m1", text: "本文その1\n\n— paper.pdf · p.3", createdAt: "2026-10-30T10:00:00.000Z" },
  { id: "m2", text: "本文その2", createdAt: "2026-10-30T09:00:00.000Z", usedIn: [{ noteId: "n", noteTitle: "N", insertedAt: "2026-10-30T10:30:00.000Z" }] },
];

describe("splitMemoBody", () => {
  it("最後の区切りで本文と出典に分ける", () => {
    expect(splitMemoBody("本文\n\n— a.pdf")).toEqual({ body: "本文", sourceLine: "— a.pdf" });
    expect(splitMemoBody("a\n\n— b\n\n— c")).toEqual({ body: "a\n\n— b", sourceLine: "— c" });
  });

  it("区切りが無ければ出典なし", () => {
    expect(splitMemoBody("本文だけ")).toEqual({ body: "本文だけ", sourceLine: null });
  });
});

describe("MemoList", () => {
  it("本文と出典を別の行に出す", () => {
    render(
      <LocaleProvider>
        <MemoList memos={MEMOS} />
      </LocaleProvider>,
    );
    expect(screen.getByText("本文その1")).toBeTruthy();
    expect(screen.getByText("— paper.pdf · p.3")).toBeTruthy();
    expect(screen.getByText("本文その2")).toBeTruthy();
    // 引用済みの件数
    expect(screen.getByText(/citation/)).toBeTruthy();
  });

  it("onDeleteMemo / onOpenMemo が無ければ削除ボタンも押せる項目も出ない", () => {
    const { container } = render(
      <LocaleProvider>
        <MemoList memos={MEMOS} />
      </LocaleProvider>,
    );
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[data-test="memoListItem"]')).toBeNull();
  });

  it("削除ボタンは onDeleteMemo があるときだけ。押すと id を渡す", () => {
    const onDelete = vi.fn();
    render(
      <LocaleProvider>
        <MemoList memos={MEMOS} onDeleteMemo={onDelete} />
      </LocaleProvider>,
    );
    const buttons = screen.getAllByRole("button", { name: "Delete memo" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    expect(onDelete).toHaveBeenCalledWith("m1");
  });

  it("項目を押す／Enter で onOpenMemo に id を渡す", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <LocaleProvider>
        <MemoList memos={MEMOS} onOpenMemo={onOpen} />
      </LocaleProvider>,
    );
    const items = container.querySelectorAll('[data-test="memoListItem"]');
    expect(items).toHaveLength(2);
    fireEvent.click(items[1]);
    expect(onOpen).toHaveBeenLastCalledWith("m2");
    fireEvent.keyDown(items[0], { key: "Enter" });
    expect(onOpen).toHaveBeenLastCalledWith("m1");
  });

  it("0 件は emptyContent を出す（無ければ何も出さない）", () => {
    const { container, rerender } = render(
      <LocaleProvider>
        <MemoList memos={[]} emptyContent="まだありません" />
      </LocaleProvider>,
    );
    expect(screen.getByText("まだありません")).toBeTruthy();
    rerender(
      <LocaleProvider>
        <MemoList memos={[]} />
      </LocaleProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
