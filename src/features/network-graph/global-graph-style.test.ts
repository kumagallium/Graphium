// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import {
  litScreenPx,
  LIT_USED_SCREEN_PX,
  LIT_EARLIER_SCREEN_PX,
  LIT_READ_SCREEN_PX,
  applyZoomStyle,
  globalGraphStyle,
  HOVER_LABEL_PADDING_SCREEN_PX,
  HOVER_LABEL_SCREEN_PX,
  ISLAND_LABELS_HOVER_OPACITY,
  NODE_MIN_SCREEN_PX,
  NODE_SHRINK_FROM_ZOOM,
  nodeSizeForZoom,
  setIslandLabelsDimmed,
  shrinkForZoom,
} from "./global-graph-view";
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
    expect(cy.getElementById("s").style("background-color")).toBe("rgb(190,189,184)");
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

describe("AI に使われたページの灯り", () => {
  it("シンプル表示で act を持つノードだけ緑になり、種類表示では塗り替えない", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: globalGraphStyle,
      elements: [
        { data: { id: "a", color: "#45433f", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "a", act: 1 }, classes: "simple" },
        { data: { id: "b", color: "#45433f", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "b" }, classes: "simple" },
        { data: { id: "c", color: "#5b8fb9", borderColor: "#000", shape: "ellipse", size: 20, fullLabel: "c", act: 1 } },
      ],
    });
    expect(cy.getElementById("a").style("background-color")).toBe("rgb(47, 107, 58)");
    expect(cy.getElementById("b").style("background-color")).toBe("rgb(69,67,63)");
    expect(cy.getElementById("c").style("background-color")).toBe("rgb(91,143,185)");
  });
});

describe("ズームに応じた見た目（寄せるとまばらに）", () => {
  it("基準より引いた状態では素の大きさ、寄せると画面上の伸びが抑えられる", () => {
    expect(nodeSizeForZoom(32, 0.2)).toBe(32);
    expect(nodeSizeForZoom(32, NODE_SHRINK_FROM_ZOOM)).toBe(32);
    // 画面上の直径（直径×ズーム）は増えるが、ズームほどは増えない
    const at1 = nodeSizeForZoom(32, 1) * 1;
    const at3 = nodeSizeForZoom(32, 3) * 3;
    expect(at3).toBeGreaterThan(at1);
    expect(at3 / at1).toBeLessThan(3);
  });

  it("寄せたとき、小さいノードも画面上の最小の直径は保つ", () => {
    expect(nodeSizeForZoom(2, 3) * 3).toBeCloseTo(NODE_MIN_SCREEN_PX);
    // 基準のすぐ上では最小値はまだほとんど効かない（大きさが跳ねない）
    expect(nodeSizeForZoom(2, NODE_SHRINK_FROM_ZOOM * 1.01)).toBeLessThan(2.1);
  });

  const make = () =>
    cytoscape({
      headless: true,
      styleEnabled: true,
      style: globalGraphStyle,
      elements: [
        { data: { id: "a", color: "#000", borderColor: "#000", shape: "ellipse", size: 32, label: "a", fullLabel: "a" } },
        { data: { id: "b", color: "#000", borderColor: "#000", shape: "ellipse", size: 32, label: "b", fullLabel: "b" } },
        { data: { id: "hub" }, classes: "cluster-hub" },
      ],
    });

  it("ズームが止まって合わせるまでは素の大きさ、合わせると縮み、大きさの書き換えにも追従する", () => {
    const cy = make();
    expect(cy.getElementById("a").numericStyle("width")).toBe(32);
    cy.zoom(3);
    applyZoomStyle(cy);
    expect(cy.getElementById("a").numericStyle("width")).toBeCloseTo(nodeSizeForZoom(32, 3));
    cy.getElementById("a").data("size", 40);
    expect(cy.getElementById("a").numericStyle("width")).toBeCloseTo(nodeSizeForZoom(40, 3));
    // 重心ダミーは 1px のまま
    expect(cy.getElementById("hub").numericStyle("width")).toBe(1);
  });

  it("ホバー中のノードの題は、引いた状態でも画面上で読める大きさになる", () => {
    const cy = make();
    cy.zoom(0.2);
    applyZoomStyle(cy);
    const a = cy.getElementById("a");
    a.addClass("hover");
    expect(a.numericStyle("font-size") * 0.2).toBeCloseTo(HOVER_LABEL_SCREEN_PX);
    expect(a.numericStyle("min-zoomed-font-size")).toBe(0);
    a.removeClass("hover");
    expect(a.numericStyle("font-size") * 0.2).toBeLessThan(HOVER_LABEL_SCREEN_PX);
  });

  it("ホバーの題の白地の余白も画面上で一定（引いても字が縁で切れて見えない）", () => {
    const cy = make();
    for (const z of [0.2, 1, 3]) {
      cy.zoom(z);
      applyZoomStyle(cy);
      const a = cy.getElementById("a");
      a.addClass("hover");
      expect(parseFloat(String(a.style("text-background-padding"))) * z).toBeCloseTo(HOVER_LABEL_PADDING_SCREEN_PX);
      a.removeClass("hover");
    }
  });
});

describe("ズームに応じた線の太さ", () => {
  it("シンプル表示の線は寄せたら細く（ノードの最小の大きさは線にかけない）", () => {
    const cy = cytoscape({
      headless: true,
      styleEnabled: true,
      style: globalGraphStyle,
      elements: [
        { data: { id: "a", color: "#000", borderColor: "#000", shape: "ellipse", size: 32 } },
        { data: { id: "b", color: "#000", borderColor: "#000", shape: "ellipse", size: 32 } },
        { data: { id: "e", source: "a", target: "b", color: "#000", lineStyle: "solid" }, classes: "simple" },
      ],
    });
    cy.zoom(3);
    applyZoomStyle(cy);
    const w = cy.getElementById("e").numericStyle("width");
    expect(w).toBeCloseTo(shrinkForZoom(0.6, 3));
    expect(w).toBeLessThan(0.6);
  });
});

describe("ホバー中の島の名前", () => {
  it("薄くしてマウスを素通りさせ、外れたら戻す", () => {
    const wrap = document.createElement("div");
    const btn = document.createElement("button");
    btn.setAttribute("data-island-label", "i1");
    btn.style.pointerEvents = "auto";
    wrap.appendChild(btn);
    setIslandLabelsDimmed(wrap, true);
    expect(wrap.style.opacity).toBe(String(ISLAND_LABELS_HOVER_OPACITY));
    expect(btn.style.pointerEvents).toBe("none");
    setIslandLabelsDimmed(wrap, false);
    expect(wrap.style.opacity).toBe("");
    expect(btn.style.pointerEvents).toBe("auto");
    // 島が無いとき（ref が空）は何もしない
    expect(() => setIslandLabelsDimmed(null, true)).not.toThrow();
  });
});

describe("litScreenPx", () => {
  it("使った（この答え）> 前の答え > 読んだだけ の順に大きく、触れていなければ 0", () => {
    expect(litScreenPx(1, false)).toBe(LIT_USED_SCREEN_PX);
    expect(litScreenPx(1, true)).toBe(LIT_USED_SCREEN_PX);
    expect(litScreenPx(0.5, false)).toBe(LIT_EARLIER_SCREEN_PX);
    expect(litScreenPx(0, true)).toBe(LIT_READ_SCREEN_PX);
    expect(litScreenPx(0, false)).toBe(0);
    expect(LIT_USED_SCREEN_PX).toBeGreaterThan(LIT_EARLIER_SCREEN_PX);
    expect(LIT_EARLIER_SCREEN_PX).toBeGreaterThan(LIT_READ_SCREEN_PX);
  });
});
