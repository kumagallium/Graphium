// @vitest-environment jsdom
// メモギャラリー表示（gallery モード）の複数選択のテスト。
//
// 対象の不変条件:
// - gallery のタイルにチェックボックスがあり、押すと選択バー（n / total）が出る
// - 選択バーの一括削除は gallery でも出て、確認後に選んだ id で onDeleteMemo が呼ばれる
// - ヘッダーの「すべて選択」で全件選択 → もう一度押すと解除
// - 表示モード（list ⇄ gallery）を切り替えても選択は残る
//
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";

import { LocaleProvider } from "../../i18n";
import { MemoGalleryView } from "./MemoGalleryView";
import type { CaptureEntry, CaptureIndex } from "./capture-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom は matchMedia / 各種 Observer を持たない。描画に必要な最低限を代役で埋める
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoopObserver;
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver ??= NoopObserver;

function memoEntry(n: number, createdAt: string): CaptureEntry {
  return {
    id: `memo-${n}`,
    text: `メモ本文 ${n}`,
    createdAt,
    usedIn: [],
  };
}

// getActiveCaptures は並べ替えないので、配列の順がそのまま表示順になる
const CAPTURE_INDEX: CaptureIndex = {
  version: 1,
  updatedAt: "2026-01-04T00:00:00.000Z",
  captures: [
    memoEntry(1, "2026-01-03T00:00:00.000Z"),
    memoEntry(2, "2026-01-02T00:00:00.000Z"),
    memoEntry(3, "2026-01-01T00:00:00.000Z"),
  ],
};

function renderGallery(onDeleteMemo?: (captureId: string) => void) {
  return render(
    <LocaleProvider>
      <MemoGalleryView
        captureIndex={CAPTURE_INDEX}
        loading={false}
        onBack={() => {}}
        onDeleteMemo={onDeleteMemo}
      />
    </LocaleProvider>,
  );
}

/** タイル／行のチェックボックス（包む要素）を上から順に返す */
function checkboxCells(): HTMLElement[] {
  return screen.getAllByTitle("Drag or shift-click to select a range");
}

/** チェックボックスを 1 つトグルする（mousedown で即トグル → mouseup で確定） */
function toggle(index: number): void {
  fireEvent.mouseDown(checkboxCells()[index], { button: 0 });
  fireEvent.mouseUp(window);
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("メモのギャラリー表示の複数選択", () => {
  it("タイルのチェックボックスで選択すると選択バーが出る", () => {
    renderGallery();
    // 選択前はバーが無い
    expect(screen.queryByText("1 / 3")).toBeNull();

    expect(checkboxCells()).toHaveLength(3);
    toggle(0);

    expect(screen.getByText("1 / 3")).toBeTruthy();
  });

  it("2 件選んで一括削除すると選択 id で onDeleteMemo が呼ばれる", async () => {
    const deleted: string[] = [];
    renderGallery((id) => {
      deleted.push(id);
    });

    toggle(0);
    toggle(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));

    // 確認ダイアログの「削除」を押して初めて実行される
    const dialog = screen.getByText("Delete selected memos").closest("div") as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleted).toEqual(["memo-1", "memo-2"]));
    // 削除後は選択が解けてバーごと消える
    await waitFor(() => expect(screen.queryByText("2 / 3")).toBeNull());
  });

  it("ヘッダーの「すべて選択」で全件選択 → もう一度で解除", () => {
    renderGallery();

    fireEvent.click(screen.getByTitle("Select all"));
    expect(screen.getByText("3 / 3")).toBeTruthy();

    // 全選択中はタイトルが「選択解除」に変わる（同じチェックボックス）
    fireEvent.click(screen.getByTitle("Clear selection"));
    expect(screen.queryByText("3 / 3")).toBeNull();
  });

  it("list → gallery に切り替えても選択は残る", () => {
    renderGallery();

    // list へ切り替えて 2 件選ぶ
    fireEvent.click(screen.getByTitle("List"));
    toggle(0);
    toggle(1);
    expect(screen.getByText("2 / 3")).toBeTruthy();

    // gallery に戻しても選択はそのまま
    fireEvent.click(screen.getByTitle("Gallery"));
    expect(screen.getByText("2 / 3")).toBeTruthy();
    const boxes = checkboxCells().map(
      (cell) => (cell.querySelector("input[type=checkbox]") as HTMLInputElement).checked,
    );
    expect(boxes).toEqual([true, true, false]);
  });
});
