import { describe, expect, it } from "vitest";
import { bundleEdges, edgeCompatibility, type BundleEdge } from "./edge-bundling";

const e = (x1: number, y1: number, x2: number, y2: number): BundleEdge => ({
  source: { x: x1, y: y1 },
  target: { x: x2, y: y2 },
});

describe("edgeCompatibility", () => {
  it("平行で長さも位置も近い辺は相性が高い", () => {
    expect(edgeCompatibility(e(0, 0, 100, 0), e(0, 10, 100, 10))).toBeGreaterThan(0.8);
  });

  it("直交する辺は相性 0", () => {
    expect(edgeCompatibility(e(0, 0, 100, 0), e(50, -50, 50, 50))).toBe(0);
  });

  it("遠く離れた辺は相性が低い", () => {
    expect(edgeCompatibility(e(0, 0, 100, 0), e(0, 1000, 100, 1000))).toBeLessThan(0.2);
  });

  it("長さ 0 の辺は相性 0", () => {
    expect(edgeCompatibility(e(0, 0, 0, 0), e(0, 0, 100, 0))).toBe(0);
  });
});

describe("bundleEdges", () => {
  it("両端の座標は動かさない", () => {
    const edges = [e(0, 0, 200, 0), e(0, 20, 200, 20)];
    const paths = bundleEdges(edges);
    paths.forEach((p, i) => {
      expect(p[0]).toEqual(edges[i].source);
      expect(p[p.length - 1]).toEqual(edges[i].target);
    });
  });

  it("平行な 2 本は中ほどで互いに近づく", () => {
    const paths = bundleEdges([e(0, 0, 200, 0), e(0, 40, 200, 40)]);
    const m = Math.floor(paths[0].length / 2);
    const gap = Math.abs(paths[0][m].y - paths[1][m].y);
    expect(gap).toBeLessThan(20);
  });

  it("向きが逆でも平行なら束ねる", () => {
    const paths = bundleEdges([e(0, 0, 200, 0), e(200, 40, 0, 40)]);
    const m = Math.floor(paths[0].length / 2);
    const gap = Math.abs(paths[0][m].y - paths[1][m].y);
    expect(gap).toBeLessThan(20);
  });

  it("なかまのいない辺は直線のまま", () => {
    const paths = bundleEdges([e(0, 0, 200, 0), e(100, -100, 100, 100)]);
    for (const p of paths[0]) expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it("入力の順に、同じ数の点列を返す", () => {
    const edges = [e(0, 0, 100, 0), e(0, 10, 100, 10), e(0, 0, 0, 0)];
    const paths = bundleEdges(edges, { cycles: 3 });
    expect(paths).toHaveLength(3);
    // 3 周回で分割数は 2→4→8。点は両端を含めて 9 個
    expect(paths[0]).toHaveLength(9);
  });
});
