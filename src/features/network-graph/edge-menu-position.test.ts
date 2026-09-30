import { describe, it, expect } from "vitest";
import { fitInside, intersectRects } from "./edge-menu-position";

const box = (left: number, top: number, w: number, h: number) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

describe("fitInside", () => {
  const bounds = box(0, 0, 1000, 600);
  it("収まっていれば動かさない", () => {
    expect(fitInside(box(100, 100, 136, 38), bounds)).toEqual({ dx: 0, dy: 0 });
  });
  it("右端からはみ出した分だけ左へ押し戻す（余白 4）", () => {
    expect(fitInside(box(900, 100, 136, 38), bounds)).toEqual({ dx: -40, dy: 0 });
  });
  it("左端・下端も押し戻す", () => {
    expect(fitInside(box(-30, 590, 136, 38), bounds)).toEqual({ dx: 34, dy: -32 });
  });
  it("境界より大きいときは左上を揃える", () => {
    expect(fitInside(box(50, 50, 2000, 38), bounds).dx).toBe(4 - 50);
  });
});

describe("intersectRects", () => {
  it("パネルとビューポートの共通部分を返す", () => {
    expect(intersectRects(box(0, 0, 1240, 700), box(0, 0, 1280, 660))).toEqual(
      box(0, 0, 1240, 660),
    );
  });
});
