import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { seedNearPlacedNeighbors } from "./use-graph-layout";

// 島を保つ組み直しで、新しいノードをどこに仮置きするか
describe("seedNearPlacedNeighbors", () => {
  const build = () =>
    cytoscape({
      headless: true,
      layout: { name: "preset" },
      elements: [
        { data: { id: "a" }, position: { x: 0, y: 0 } },
        { data: { id: "b" }, position: { x: 200, y: 0 } },
        { data: { id: "far" }, position: { x: 5000, y: 5000 } },
        { data: { id: "new" }, position: { x: 0, y: 0 } },
        { data: { id: "lonely" }, position: { x: 0, y: 0 } },
        { data: { id: "e1", source: "new", target: "a" } },
        { data: { id: "e2", source: "new", target: "b" } },
      ],
    });

  it("座標のある隣の平均の近くに置く（外周の輪に飛ばさない）", () => {
    const cy = build();
    seedNearPlacedNeighbors(cy, ["new", "lonely"]);
    const p = cy.getElementById("new").position();
    expect(Math.hypot(p.x - 100, p.y - 0)).toBeLessThanOrEqual(30);
  });

  it("隣に座標のあるノードが無いものは、置いた範囲の外周に置く", () => {
    const cy = build();
    seedNearPlacedNeighbors(cy, ["new", "lonely"]);
    const p = cy.getElementById("lonely").position();
    // a・b・far・new の範囲の中心から、範囲の半分より外
    expect(Math.hypot(p.x - 2500, p.y - 2500)).toBeGreaterThan(2500);
  });

  it("座標のあるノードは動かさない", () => {
    const cy = build();
    seedNearPlacedNeighbors(cy, ["new", "lonely"]);
    expect(cy.getElementById("a").position()).toEqual({ x: 0, y: 0 });
    expect(cy.getElementById("far").position()).toEqual({ x: 5000, y: 5000 });
  });
});
