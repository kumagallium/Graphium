// @vitest-environment jsdom
// 改ページの目安の線の高さ: 用紙の上端からの位置 + 用紙の机の中での上端（机の根基準に直す足し算）

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";
import { PageGuides } from "./PageGuides";
import { PaperFrame } from "./PaperFrame";

// 位置の足し算のテスト用。測り（印刷と同じ木の組み立て）と配置は差し替える
vi.mock("./measure-print-layout", async (orig) => ({
  ...(await orig<typeof import("./measure-print-layout")>()),
  measurePageBreaks: vi.fn(async () => []),
  collectPageBlocks: vi.fn(() => []),
}));
vi.mock("./page-breaks", async (orig) => ({
  ...(await orig<typeof import("./page-breaks")>()),
  placeBreaksOnScreen: vi.fn(() => [{ top: 200, page: 2 }]),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function withFrameWidth(width: number, fn: () => void) {
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => width });
  try {
    fn();
  } finally {
    if (desc) Object.defineProperty(HTMLElement.prototype, "offsetWidth", desc);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  }
}

describe("PageGuides の線の高さ", () => {
  it("線の top は 用紙の上端からの位置 + (目印の上端 - 机の上端) になる", async () => {
    // 机の上端 = 40、目印の上端 = 100 → 机の中での用紙の上端は 60。ページ 2 は用紙の上端から 200
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      const top = this.hasAttribute("data-page-guides") ? 100 : this.getAttribute("data-paper-layout") === "sheet" ? 40 : 0;
      return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    };
    try {
      let container!: HTMLElement;
      withFrameWidth(1200, () => {
        ({ container } = render(
          <LocaleProvider>
            <PaperFrame mode="a4" overlay={<PageGuides title="題名" />}>
              本文
            </PaperFrame>
          </LocaleProvider>,
        ));
      });
      // 本文が無いと測らないので、エディタ要素を置いて測りを起こす
      const sheet = container.querySelector<HTMLElement>(`[${PAPER_SHEET_ATTR}]`)!;
      const editor = document.createElement("div");
      editor.className = "bn-editor";
      sheet.appendChild(editor);
      await waitFor(
        () => {
          const g = container.querySelector<HTMLElement>("[data-page-guide]");
          expect(g).not.toBeNull();
          expect(g!.style.top).toBe("260px");
        },
        { timeout: 3000 },
      );
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
  });
});
