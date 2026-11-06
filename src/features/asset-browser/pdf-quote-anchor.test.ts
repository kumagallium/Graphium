// @vitest-environment jsdom
// pdf-quote-anchor のテスト。pdf.js の text-layer を模した DOM（行ごとの span）で、
// - 選択範囲から文と前後が取れる（行またぎ・端の空白）
// - 同じ文が 2 か所にあっても、前後で選んだ方へ戻れる
// - 残したページに無ければ他のページから探す・どこにも無ければ null
// を確かめる。

import { describe, expect, it } from "vitest";
import { locateQuoteInPages, quoteAnchorForRange } from "./pdf-quote-anchor";

function makePage(lines: string[]): HTMLElement {
  const page = document.createElement("div");
  const layer = document.createElement("div");
  layer.className = "textLayer";
  for (const line of lines) {
    const span = document.createElement("span");
    span.textContent = line;
    layer.appendChild(span);
  }
  page.appendChild(layer);
  document.body.appendChild(page);
  return page;
}

function textNode(page: HTMLElement, line: number): Text {
  return page.querySelectorAll(".textLayer span")[line].firstChild as Text;
}

describe("quoteAnchorForRange", () => {
  it("1 行の中の選択から、文と前後を取る", () => {
    const page = makePage(["Proofing notes", "Let the dough rest for an hour.", "Shape the loaf."]);
    const range = document.createRange();
    const t = textNode(page, 1);
    range.setStart(t, 4);
    range.setEnd(t, 18); // "the dough rest"
    const anchor = quoteAnchorForRange(page, range);
    expect(anchor?.exact).toBe("the dough rest");
    expect(anchor?.prefix).toBe("Proofing notes Let ");
    expect(anchor?.suffix).toBe(" for an hour. Shape the loaf.");
  });

  it("行をまたぐ選択は、行の境目を空白 1 つで繋ぐ", () => {
    const page = makePage(["rest for an", "hour at room"]);
    const range = document.createRange();
    range.setStart(textNode(page, 0), 5);
    range.setEnd(textNode(page, 1), 4);
    expect(quoteAnchorForRange(page, range)?.exact).toBe("for an hour");
  });

  it("前後は指定の文字数で切る", () => {
    const page = makePage(["0123456789 target 0123456789"]);
    const range = document.createRange();
    const t = textNode(page, 0);
    range.setStart(t, 11);
    range.setEnd(t, 17);
    const anchor = quoteAnchorForRange(page, range, 4);
    expect(anchor).toEqual({ exact: "target", prefix: "789 ", suffix: " 012" });
  });

  it("text-layer の外の選択は null", () => {
    const page = makePage(["abc"]);
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    expect(quoteAnchorForRange(page, range)).toBeNull();
  });
});

describe("locateQuoteInPages", () => {
  it("同じ文が 2 か所あれば、前後が合う方を選ぶ", () => {
    const page = makePage(["Mix well. Rest 10 min.", "Shape. Rest 10 min. Bake."]);
    const match = locateQuoteInPages([[1, page]], { exact: "Rest 10 min.", prefix: "Shape. ", suffix: " Bake." }, 1);
    expect(match?.range.toString()).toBe("Rest 10 min.");
    expect(match?.range.startContainer).toBe(textNode(page, 1));
  });

  it("残したページに無ければ、ほかのページから探す", () => {
    const p1 = makePage(["Intro"]);
    const p2 = makePage(["Let the dough rest."]);
    const match = locateQuoteInPages([[1, p1], [2, p2]], { exact: "dough rest" }, 1);
    expect(match?.pageNumber).toBe(2);
  });

  it("どこにも無ければ null", () => {
    const page = makePage(["Bake at 220 C."]);
    expect(locateQuoteInPages([[1, page]], { exact: "proof overnight" }, 1)).toBeNull();
  });
});
