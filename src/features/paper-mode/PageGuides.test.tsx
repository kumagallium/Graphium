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
    // 線は左右の机に 1 本ずつ（用紙の上には引かない）
    expect([...guides[0].querySelectorAll("[data-guide-line]")].map((e) => (e as HTMLElement).dataset.guideLine)).toEqual([
      "left",
      "right",
    ]);
  });

  it("番号は右の机に置き、机が狭いときだけ用紙の右の余白の中へ寄せる", () => {
    const lines = [{ top: 100, page: 2 }];
    // 広い机（1280px の枠。右の机は約 243px）
    withFrameWidth(1280, () => {
      const { container } = render(
        <LocaleProvider>
          <PageGuidesLayer lines={lines} />
        </LocaleProvider>,
      );
      const num = container.querySelector<HTMLElement>("[data-guide-number]")!;
      expect(num.dataset.guideNumber).toBe("desk");
      expect(num.style.transform).toBe("translateY(-50%)");
    });
    cleanup();
    // 用紙がぎりぎり入る枠（818px。右の机は 12px）
    withFrameWidth(818, () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const { container } = render(
        <LocaleProvider>
          <PageGuidesLayer lines={lines} paperHost={host} paperHostOffset={30} />
        </LocaleProvider>,
      );
      // 机の層には出さず、用紙の中（目印）へ描く。用紙より手前に出るため
      expect(container.querySelector("[data-guide-number]")).toBeNull();
      const num = host.querySelector<HTMLElement>("[data-guide-number]")!;
      expect(num.dataset.guideNumber).toBe("paper");
      expect(num.style.right).toBe("8px");
      expect(num.style.top).toBe("70px");
      expect(num.style.transform).toBe("translateY(-50%)");
    });
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

describe("PageGuides の置き場所", () => {
  it("線と番号は机の中の層（用紙の外）に描き、用紙の中には目印だけを置く", async () => {
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
    const desk = container.querySelector<HTMLElement>('[data-paper-layout="sheet"]')!;
    const layer = desk.querySelector<HTMLElement>(":scope > [data-paper-desk-layer]")!;
    expect(layer).not.toBeNull();
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.style.pointerEvents).toBe("none");
    // 層は用紙の外（机の直下）にある。用紙とは入れ子にならない
    const sheet = desk.querySelector(`[${PAPER_SHEET_ATTR}]`)!;
    expect(sheet.contains(layer)).toBe(false);
    // 層の中に描く部品がある。用紙の中には描かない
    await waitFor(() => expect(layer.querySelector("[data-page-guides-layer]")).not.toBeNull());
    expect(sheet.querySelector("[data-page-guides-layer]")).toBeNull();
    expect(sheet.querySelector("[data-page-guide]")).toBeNull();
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

    // jsdom の Range には getClientRects が無い。測りが本当に走るようモックする
    const rangeProto = Range.prototype as unknown as { getClientRects?: () => unknown };
    const hadRects = "getClientRects" in rangeProto;
    const origRects = rangeProto.getClientRects;
    rangeProto.getClientRects = () => [];
    // 測る木が body に現れたことを記録する（測りが実際に走った証拠）
    let measured = false;
    const bodyMo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (n instanceof Element && n.classList.contains("graphium-print-measure")) measured = true;
        });
      }
    });
    bodyMo.observe(document.body, { childList: true });

    try {
      // 題名・ラベルの effect が測りを 800ms に張り直すので、それを超えて待つ
      await new Promise((r) => setTimeout(r, 1200));
      await waitFor(() => expect(measured).toBe(true));
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      bodyMo.disconnect();
      if (hadRects) rangeProto.getClientRects = origRects;
      else delete rangeProto.getClientRects;
    }
    expect(container.querySelector("[data-page-guides]")).not.toBeNull();
    mo.disconnect();

    expect(editor.outerHTML).toBe(before);
    expect(mutations).toEqual([]);
    // 測る木は残さない
    expect(document.querySelector(".graphium-print-measure")).toBeNull();
  });
});
