// @vitest-environment jsdom
// 段組みのドロップ領域（左右 1/3 ずつ）の基準になる「中身の左右端」（contentEdges）の検査。
//
// BlockNote 0.48〜0.52 で .bn-inline-content の width:100% が本家の CSS から外れ、文字欄が
// 文字の長さまで縮むようになった。文字欄の幅を基準にすると「右の領域が文字の終わりから行末まで
// 広がり、左の領域はほぼ消える」ので、文字のブロックはブロック矩形（本文欄の全幅）を使う。
// 画像など中身が本文欄より狭いブロックは、従来どおり中身の左右端を使う。
import { describe, it, expect, afterEach } from "vitest";
import { contentEdges } from "./drop-to-columns";

function rect(left: number, width: number): DOMRect {
  return { left, right: left + width, width, x: left, y: 0, top: 0, bottom: 20, height: 20, toJSON: () => ({}) } as DOMRect;
}

function block(childClass: string, childLeft: number, childWidth: number): HTMLElement {
  const outer = document.createElement("div");
  outer.setAttribute("data-node-type", "blockOuter");
  outer.getBoundingClientRect = () => rect(0, 720);
  const content = document.createElement("div");
  content.className = "bn-block-content";
  const child = document.createElement("div");
  child.className = childClass;
  child.getBoundingClientRect = () => rect(childLeft, childWidth);
  content.appendChild(child);
  outer.appendChild(content);
  document.body.appendChild(outer);
  return outer;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("contentEdges（段組みのドロップ領域の基準）", () => {
  it("文字のブロック（.bn-inline-content）は null（ブロックの全幅を使う）", () => {
    // 文字欄が文字の長さ（230px）に縮んでいても、基準にしない
    expect(contentEdges(block("bn-inline-content", 0, 230))).toBeNull();
  });

  it("中身が狭いブロック（画像など）は中身の左右端を返す", () => {
    expect(contentEdges(block("bn-file-block-content-wrapper", 0, 320))).toEqual({ left: 0, right: 320 });
  });
});
