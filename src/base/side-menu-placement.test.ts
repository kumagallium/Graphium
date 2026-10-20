// @vitest-environment jsdom
// サイドメニュー（＋⠿）の置き場所の検査（side-menu-placement.ts）。
// 見出しは 1 行目の中央に合わせて ▶ のぶん左へ、それ以外は BlockNote と同じ固定のずらし。
import { describe, it, expect, afterEach } from "vitest";
import { sideMenuPlacementMiddleware, HEADING_HANDLE_SHIFT_PX } from "./side-menu-placement";

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function editorWithHeading(textTop: number, lineHeight: number) {
  const root = document.createElement("div");
  const outer = document.createElement("div");
  outer.setAttribute("data-id", "h");
  outer.setAttribute("data-node-type", "blockOuter");
  const content = document.createElement("div");
  content.className = "bn-block-content";
  const text = document.createElement("h1");
  text.className = "bn-inline-content";
  text.style.lineHeight = `${lineHeight}px`;
  text.getBoundingClientRect = () => rect(textTop, lineHeight * 2);
  content.appendChild(text);
  outer.appendChild(content);
  root.appendChild(outer);
  document.body.appendChild(root);
  return {
    domElement: root,
    schema: { blockSpecs: { image: { implementation: { meta: { fileBlockAccept: ["image/*"] } } } } },
  };
}

const state = (referenceTop: number, floatingHeight = 30) => ({
  x: 100,
  y: referenceTop,
  rects: { floating: { height: floatingHeight } },
  elements: { reference: { getBoundingClientRect: () => rect(referenceTop, 60) } },
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("sideMenuPlacementMiddleware", () => {
  it("見出しは 1 行目の中央に合わせ、▶ のぶん左へ寄せる", () => {
    // 文字の上端 254・行の高さ 39 → 1 行目の中央は 273.5。参照（ブロック）の上端 236、メニュー 30 → y = 236 + 22.5
    const editor = editorWithHeading(254, 39);
    const mw = sideMenuPlacementMiddleware(editor, () => ({ id: "h", type: "heading", props: { level: 1 } }));
    expect(mw.fn(state(236))).toEqual({ x: 100 - HEADING_HANDLE_SHIFT_PX, y: 236 + 22.5 });
  });

  it("2 行に折り返した見出しでも 1 行目に合わせる（矩形の中央ではない）", () => {
    const editor = editorWithHeading(254, 39);
    const mw = sideMenuPlacementMiddleware(editor, () => ({ id: "h", type: "heading" }));
    const { y } = mw.fn(state(236)) as { y: number };
    expect(y + 15).toBeCloseTo(254 + 39 / 2);
  });

  it("見出し以外は BlockNote と同じ固定のずらし", () => {
    const editor = editorWithHeading(0, 20);
    const at = (block: any) => sideMenuPlacementMiddleware(editor, () => block).fn(state(50));
    expect(at({ id: "p", type: "paragraph" })).toEqual({ x: 100, y: 50 });
    expect(at({ id: "i", type: "image", props: { url: "" } })).toEqual({ x: 100, y: 62 });
    expect(at({ id: "f", type: "file", props: { url: "x" } })).toEqual({ x: 100, y: 54 });
    expect(at({ id: "t", type: "table" })).toEqual({ x: 100, y: 65 });
  });

  it("対象ブロックは計算のたびに読む（作ったときのブロックに縛られない）", () => {
    const editor = editorWithHeading(254, 39);
    let current: any = { id: "p", type: "paragraph" };
    const mw = sideMenuPlacementMiddleware(editor, () => current);
    expect((mw.fn(state(236)) as { x: number }).x).toBe(100);
    current = { id: "h", type: "heading" };
    expect((mw.fn(state(236)) as { x: number }).x).toBe(100 - HEADING_HANDLE_SHIFT_PX);
  });
});
