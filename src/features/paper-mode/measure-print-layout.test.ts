// @vitest-environment jsdom
// 改ページの目安の測り（DOM の読み取り）。jsdom にはレイアウトが無いので、
// 要素に data-top / data-bottom で寸法を持たせ、getBoundingClientRect を差し替えて読む。
// 実際の寸法（印刷と同じ木・行の取り方）は実ブラウザで確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectPageBlocks } from "./measure-print-layout";

function rectOf(el: Element): DOMRect {
  const top = Number(el.getAttribute("data-top") ?? 0);
  const bottom = Number(el.getAttribute("data-bottom") ?? 0);
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
}

beforeEach(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return rectOf(this);
  });
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
    return (this.hasAttribute("data-top") ? [rectOf(this)] : []) as unknown as DOMRectList;
  });
  // jsdom の Range は矩形を持たない（文字の行はここでは取れない）
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function editorOf(html: string): HTMLElement {
  const ed = document.createElement("div");
  ed.className = "bn-editor";
  ed.innerHTML = html;
  document.body.appendChild(ed);
  return ed;
}

const outer = (id: string, top: number, bottom: number, content: string, children = "") =>
  `<div class="bn-block-outer" data-node-type="blockOuter" data-id="${id}">
     <div class="bn-block" data-node-type="blockContainer" data-id="${id}">
       ${content.replace("<div ", `<div data-top="${top}" data-bottom="${bottom}" `)}
       ${children ? `<div class="bn-block-group" data-node-type="blockGroup">${children}</div>` : ""}
     </div>
   </div>`;

describe("collectPageBlocks", () => {
  it("上から順に（入れ子の子は親の次）、種類つきで読む", () => {
    const ed = editorOf(`<div class="bn-block-group" data-node-type="blockGroup">
      ${outer("h", 0, 40, `<div class="bn-block-content" data-content-type="heading"><h2 class="bn-inline-content">見出し</h2></div>`)}
      ${outer("p", 40, 100, `<div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">本文</p></div>`,
        outer("child", 100, 130, `<div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">子</p></div>`))}
      ${outer("img", 130, 330, `<div class="bn-block-content" data-content-type="image"><img src="x.png"></div>`)}
      ${outer("tbl", 330, 450, `<div class="bn-block-content" data-content-type="table"><table><tbody>
        <tr data-top="330" data-bottom="390"><td>a</td></tr><tr data-top="390" data-bottom="450"><td>b</td></tr></tbody></table></div>`)}
      <div class="gph-column-list" data-node-type="columnList" data-id="cols" data-top="450" data-bottom="600">
        <div class="gph-column" data-node-type="column"><div class="bn-block-outer" data-node-type="blockOuter" data-id="inner"></div></div>
      </div>
    </div>`);
    const blocks = collectPageBlocks(ed, 0);
    expect(blocks.map((b) => [b.id, b.kind])).toEqual([
      ["h", "heading"],
      ["p", "text"],
      ["child", "text"],
      ["img", "figure"],
      ["tbl", "table"],
      ["cols", "figure"], // 段組みは 1 つの図（中には降りない）
    ]);
    expect(blocks[3]).toMatchObject({ top: 130, bottom: 330 });
    expect(blocks[4].rows).toEqual([
      { top: 330, bottom: 390 },
      { top: 390, bottom: 450 },
    ]);
  });

  it("原点を引いた y で返す", () => {
    const ed = editorOf(`<div class="bn-block-group" data-node-type="blockGroup">
      ${outer("p", 300, 360, `<div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">本文</p></div>`)}
    </div>`);
    expect(collectPageBlocks(ed, 100)[0]).toMatchObject({ top: 200, bottom: 260 });
  });

  it("行内の画像（段落の文字の中）は図にしない", () => {
    const ed = editorOf(`<div class="bn-block-group" data-node-type="blockGroup">
      ${outer("p", 0, 30, `<div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">あ<img src="x.png">い</p></div>`)}
    </div>`);
    expect(collectPageBlocks(ed, 0)[0].kind).toBe("text");
  });

  it("h4 以下は見出しにしない（印刷の break-after: avoid は h1〜h3）", () => {
    const ed = editorOf(`<div class="bn-block-group" data-node-type="blockGroup">
      ${outer("h4", 0, 30, `<div class="bn-block-content" data-content-type="heading"><h4 class="bn-inline-content">小見出し</h4></div>`)}
    </div>`);
    expect(collectPageBlocks(ed, 0)[0].kind).toBe("text");
  });

  it("畳まれて寸法の無いブロックは hidden", () => {
    const ed = editorOf(`<div class="bn-block-group" data-node-type="blockGroup">
      <div class="bn-block-outer gph-heading-hidden" data-node-type="blockOuter" data-id="x">
        <div class="bn-block"><div class="bn-block-content" data-content-type="paragraph"><p class="bn-inline-content">畳んだ</p></div></div>
      </div>
    </div>`);
    expect(collectPageBlocks(ed, 0)[0]).toMatchObject({ id: "x", hidden: true });
  });
});
