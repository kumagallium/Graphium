import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { globalGraphStyle } from "./global-graph-view";
import { GRAPH_FADED_EDGE_OPACITY, GRAPH_FADED_OPACITY } from "./graph-theme";

/** ホバーで付く faded が、基本スタイルより後に置かれて効いているか（並び順の回帰） */
describe("全体グラフのスタイルの並び順（faded が効くこと）", () => {
  const cy = cytoscape({
    headless: true,
    styleEnabled: true,
    style: globalGraphStyle,
    elements: [
      { data: { id: "a", color: "#000", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "a" } },
      { data: { id: "b", color: "#000", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "b" } },
      { data: { id: "s", color: "#000", borderColor: "#000", shape: "ellipse", size: 9, satellite: true } },
      { data: { id: "hub" }, classes: "cluster-hub" },
      { data: { id: "e", source: "a", target: "b", color: "#000", lineStyle: "solid" } },
      { data: { id: "se", source: "a", target: "s", color: "#000", lineStyle: "solid", satellite: true }, classes: "satellite-edge" },
      { data: { id: "pe", source: "a", target: "hub", virtual: true }, classes: "cluster-edge" },
    ],
  });
  cy.elements().addClass("faded");

  it("本物の辺と衛星ノード・衛星の線が薄くなる", () => {
    expect(cy.getElementById("e").numericStyle("opacity")).toBeCloseTo(GRAPH_FADED_EDGE_OPACITY);
    expect(cy.getElementById("se").numericStyle("opacity")).toBeCloseTo(GRAPH_FADED_EDGE_OPACITY);
    expect(cy.getElementById("s").numericStyle("opacity")).toBeCloseTo(GRAPH_FADED_OPACITY);
    expect(cy.getElementById("b").numericStyle("opacity")).toBeCloseTo(GRAPH_FADED_OPACITY);
  });

  it("不可視の射影の辺・重心ダミーは faded でも見えないまま", () => {
    expect(cy.getElementById("pe").numericStyle("opacity")).toBe(0);
    expect(cy.getElementById("hub").numericStyle("opacity")).toBe(0);
  });

  it("検索ヒットは faded より優先される（枠が付く）", () => {
    cy.getElementById("b").addClass("search-hit");
    expect(cy.getElementById("b").numericStyle("border-width")).toBe(4);
  });
});

describe("全体グラフのスタイル（重さの対策）", () => {
  it("ノードと辺のアニメーションは切ってある（ホバーで全要素が同時にフェードしない）", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: globalGraphStyle,
      elements: [
        { data: { id: "a", color: "#000", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "a" } },
        { data: { id: "b", color: "#000", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "b" } },
        { data: { id: "e", source: "a", target: "b", color: "#000", lineStyle: "solid" } },
      ],
    });
    expect(cy.getElementById("a").numericStyle("transition-duration")).toBe(0);
    expect(cy.getElementById("e").numericStyle("transition-duration")).toBe(0);
  });
});

/** シンプル色モード（.simple）: 形・線の色を上書きしつつ、状態スタイルには負けること */
describe("全体グラフのシンプル色モード", () => {
  const make = () =>
    cytoscape({
      headless: true,
      styleEnabled: true,
      style: globalGraphStyle,
      elements: [
        { data: { id: "a", color: "#45433f", borderColor: "#000", shape: "diamond", size: 20, fullLabel: "a" }, classes: "simple" },
        { data: { id: "b", color: "#adaba6", borderColor: "#000", shape: "round-rectangle", size: 20, fullLabel: "b" }, classes: "simple" },
        { data: { id: "s", color: "#adaba6", borderColor: "#000", shape: "ellipse", size: 9, satellite: true }, classes: "simple" },
        { data: { id: "e", source: "a", target: "b", color: "#ff0000", lineStyle: "solid" }, classes: "simple" },
        { data: { id: "k", source: "b", target: "a", color: "#ff0000", lineStyle: "solid" } },
      ],
    });

  it("形は丸、線は灰で薄く矢印なし。種類モードの線はそのまま", () => {
    const cy = make();
    expect(cy.getElementById("a").style("shape")).toBe("ellipse");
    expect(cy.getElementById("e").style("line-color")).toBe("rgb(61,59,56)");
    expect(cy.getElementById("e").style("target-arrow-shape")).toBe("none");
    expect(cy.getElementById("e").numericStyle("opacity")).toBeCloseTo(0.16);
    expect(cy.getElementById("k").style("line-color")).toBe("rgb(255,0,0)");
  });

  it("衛星は一段薄い灰、束ねた線は少し濃い", () => {
    const cy = make();
    expect(cy.getElementById("s").style("background-color")).toBe("rgb(203,205,200)");
    cy.getElementById("e").addClass("bundled");
    expect(cy.getElementById("e").numericStyle("opacity")).toBeCloseTo(0.22);
  });

  it("ホバーの faded・強調、検索ヒットはシンプルの上書きより優先される", () => {
    const cy = make();
    cy.getElementById("b").addClass("faded");
    expect(cy.getElementById("b").numericStyle("opacity")).toBeCloseTo(GRAPH_FADED_OPACITY);
    cy.getElementById("e").addClass("hover-connected");
    expect(cy.getElementById("e").numericStyle("opacity")).toBe(1);
    cy.getElementById("a").addClass("search-hit");
    expect(cy.getElementById("a").numericStyle("border-width")).toBe(4);
  });
});
