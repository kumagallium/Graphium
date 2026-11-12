// @vitest-environment jsdom
// メモ一覧（リスト表示）の「使用」「フォルダ」列。ノート一覧・ナレッジ一覧の被参照と同じ見た目で出し、
// どのメモにも値が無いときは列ごと出さない。ナレッジ化は別の列（本アイコン）で、使用には数えない。
// 文言は LocaleProvider の既定（jsdom の navigator.language → en）で照合する。

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { MemoGalleryView } from "./MemoGalleryView";
import type { CaptureEntry, CaptureIndex } from "./capture-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

beforeEach(() => {
  // リスト表示で開く
  localStorage.setItem("graphium:memoViewMode", "list");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function memo(n: number, extra: Partial<CaptureEntry> = {}): CaptureEntry {
  return { id: `memo-${n}`, text: `メモ本文 ${n}`, createdAt: `2026-01-0${n}T00:00:00.000Z`, usedIn: [], ...extra };
}

function renderList(captures: CaptureEntry[]) {
  const index: CaptureIndex = { version: 1, updatedAt: "2026-01-04T00:00:00.000Z", captures };
  return render(
    <LocaleProvider>
      <MemoGalleryView captureIndex={index} loading={false} onBack={() => {}} />
    </LocaleProvider>,
  );
}

function headers(): string[] {
  return [...document.querySelectorAll("thead th")].map((th) => th.textContent ?? "");
}

function usedCell(text: string): string {
  const col = headers().findIndex((h) => h === "Used");
  expect(col).toBeGreaterThan(-1);
  return screen.getByText(text).closest("tr")!.querySelectorAll("td")[col].textContent ?? "";
}

describe("MemoGalleryView 使用の列", () => {
  it("挿入したノートの数を、被参照と同じ見た目（← N）で出す。ナレッジ化は数えない", () => {
    renderList([
      memo(1, {
        usedIn: [
          { noteId: "n1", noteTitle: "ノート1", insertedAt: "2026-01-02T00:00:00.000Z" },
          { noteId: "n2", noteTitle: "ノート2", insertedAt: "2026-01-03T00:00:00.000Z" },
        ],
      }),
      memo(2, { knowledgedInto: [{ noteId: "w1", noteTitle: "知見1", knowledgedAt: "2026-01-03T00:00:00.000Z" }] }),
    ]);
    expect(usedCell("メモ本文 1")).toBe("← 2");
    expect(usedCell("メモ本文 2")).toBe("—");
  });

  it("フォルダに入っているメモがあればフォルダの列を出し、無ければ列ごと出さない", () => {
    const view = renderList([memo(1, { noteContexts: ["パン/発酵"] }), memo(2)]);
    const col = headers().findIndex((h) => h === "Folder");
    expect(col).toBeGreaterThan(-1);
    const cells = (text: string) => screen.getByText(text).closest("tr")!.querySelectorAll("td");
    expect(cells("メモ本文 1")[col].textContent).toContain("発酵");
    expect(cells("メモ本文 2")[col].textContent).toBe("—");
    view.unmount();
    renderList([memo(1), memo(2)]);
    expect(headers()).not.toContain("Folder");
  });

  it("どのメモも使われていないときは、使用の列ごと出さない", () => {
    renderList([memo(1), memo(2)]);
    expect(headers()).not.toContain("Used");
  });
});
