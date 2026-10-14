import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { visibleNeighborhood } from "./hover-neighborhood";

describe("visibleNeighborhood（ホバーで光らせる本物の 1 ホップ）", () => {
  it("不可視の射影・重心ダミーの辺は辿らず、本物の辺と衛星の線だけを辿る", () => {
    const cy = cytoscape({
      headless: true,
      elements: [
        { data: { id: "t1" } },
        { data: { id: "t2" } },
        { data: { id: "c1" } },
        { data: { id: "hub" }, classes: "cluster-hub" },
        { data: { id: "sat", satellite: true } },
        { data: { id: "real", source: "c1", target: "t1" } },
        { data: { id: "proj", source: "t1", target: "t2", virtual: true, projection: true }, classes: "cluster-edge" },
        { data: { id: "hubEdge", source: "t1", target: "hub", virtual: true }, classes: "cluster-edge" },
        { data: { id: "satEdge", source: "t1", target: "sat", satellite: true }, classes: "satellite-edge" },
      ],
    });
    const nb = visibleNeighborhood(cy.getElementById("t1"));
    expect(nb.nodes().map((n) => n.id()).sort()).toEqual(["c1", "sat"]);
    expect(nb.edges().map((e) => e.id()).sort()).toEqual(["real", "satEdge"]);
  });

  it("辺の無いノードでは空", () => {
    const cy = cytoscape({ headless: true, elements: [{ data: { id: "a" } }] });
    expect(visibleNeighborhood(cy.getElementById("a")).length).toBe(0);
  });
});
