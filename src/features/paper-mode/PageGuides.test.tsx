// @vitest-environment jsdom
// 改ページの目安の線の重ね描き: 用紙のときだけ出る・番号が 2 から振られる・ProseMirror の DOM を変えない

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { LocaleProvider } from "../../i18n";
import { PAPER_SHEET_ATTR } from "../../lib/pane-layout";
import { PageGuides, PageGuidesLayer } from "./PageGuides";
import { PaperFrame } from "./PaperFrame";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PageGuidesLayer", () => {
  it("線ごとに番号を出す（2 ページ目から）", () => {
    const { container } = render(
      <LocaleProvider>
        <PageGuidesLayer
          lines={[
            { top: 100, page: 2 },
            { top: 900, page: 3 },
          ]}
        />
      </LocaleProvider>,
    );
    const guides = [...container.querySelectorAll<HTMLElement>("[data-page-guide]")];
    expect(guides.map((g) => g.dataset.pageGuide)).toEqual(["2", "3"]);
    expect(guides[0].textContent).toBe("Page 2");
    expect(guides[1].textContent).toBe("Page 3");
    // 位置と、本文の操作を邪魔しないこと
    expect(guides[0].style.top).toBe("100px");
    expect(guides[0].style.pointerEvents).toBe("none");
  });

  it("線が無ければ何も出さない（1 ページ目には出さない）", () => {
    const { container } = render(
      <LocaleProvider>
        <PageGuidesLayer lines={[]} />
      </LocaleProvider>,
    );
    expect(container.querySelector("[data-page-guide]")).toBeNull();
  });
});

/** offsetWidth を差し替えて、PaperFrame に枠の幅を渡す（jsdom は寸法が 0） */
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

describe("PaperFrame の overlay", () => {
  const overlay = <div data-testid="overlay" />;

  it("用紙のときだけ差し込む", () => {
    withFrameWidth(1200, () => {
      const { container } = render(
        <LocaleProvider>
          <PaperFrame mode="a4" overlay={overlay}>
            本文
          </PaperFrame>
        </LocaleProvider>,
      );
      expect(container.querySelector('[data-paper-layout="sheet"]')).not.toBeNull();
      expect(container.querySelector(`[${PAPER_SHEET_ATTR}] [data-testid="overlay"]`)).not.toBeNull();
    });
  });

  it("標準のノート・枠が狭くて流れる本文に戻ったときは出さない", () => {
    withFrameWidth(1200, () => {
      const { container } = render(
        <LocaleProvider>
          <PaperFrame mode="standard" overlay={overlay}>
            本文
          </PaperFrame>
        </LocaleProvider>,
      );
      expect(container.querySelector('[data-testid="overlay"]')).toBeNull();
    });
    cleanup();
    withFrameWidth(500, () => {
      const { container } = render(
        <LocaleProvider>
          <PaperFrame mode="a4" overlay={overlay}>
            本文
          </PaperFrame>
        </LocaleProvider>,
      );
      expect(container.querySelector('[data-paper-layout="flow"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="overlay"]')).toBeNull();
    });
  });
});

describe("PageGuides", () => {
  it("測っても ProseMirror の DOM（本文）を一切書き換えない", async () => {
    const sheet = document.createElement("div");
    sheet.setAttribute(PAPER_SHEET_ATTR, "");
    const editor = document.createElement("div");
    editor.className = "bn-editor";
    editor.innerHTML = `<div class="bn-block-group" data-node-type="blockGroup">
      <div class="bn-block-outer" data-node-type="blockOuter" data-id="b1">
        <div class="bn-block" data-node-type="blockContainer" data-id="b1">
          <div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">本文</p></div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(sheet);
    const before = editor.outerHTML;

    const { container } = render(
      <LocaleProvider>
        <PageGuides title="題名" />
      </LocaleProvider>,
      { container: sheet },
    );
    sheet.appendChild(editor);
    const mutations: MutationRecord[] = [];
    const mo = new MutationObserver((r) => mutations.push(...r));
    mo.observe(editor, { subtree: true, childList: true, attributes: true, characterData: true });

    // 最初の測り（300ms 待ち + 非同期）が終わるまで待つ
    await new Promise((r) => setTimeout(r, 700));
    await waitFor(() => expect(container.querySelector("[data-page-guides]")).not.toBeNull());
    await Promise.resolve();
    mo.disconnect();

    expect(editor.outerHTML).toBe(before);
    expect(mutations).toEqual([]);
    // 測る木は残さない
    expect(document.querySelector(".graphium-print-measure")).toBeNull();
  });
});
