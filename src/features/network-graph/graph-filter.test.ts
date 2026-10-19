import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { applyGraphFilter } from "./graph-filter";
import type { NoteNode } from "./graph-builder";

const node = (partial: Partial<NoteNode> & { id: string; title: string }): NoteNode =>
  ({ isCurrent: false, hop: 1, ...partial }) as NoteNode;
const nodes: NoteNode[] = [
  node({ id: "n1", title: "電池の実験", noteContexts: ["電池"] }),
  node({ id: "n2", title: "読書メモ", noteContexts: ["読書"] }),
  node({ id: "n3", title: "未分類ノート" }),
  node({ id: "c1", title: "電解質の知見", isWiki: true }),
  node({ id: "s1", title: "paper.pdf", external: "pdf" }),
];
function make() {
  return cytoscape({
    headless: true,
    elements: [
      ...nodes.map((n) => ({ data: { id: n.id, fullLabel: n.title } })),
      { data: { id: "hub" }, classes: "cluster-hub" },
      { data: { id: "e1", source: "c1", target: "n1" } },
      { data: { id: "e2", source: "s1", target: "n2" } },
      { data: { id: "v", source: "n3", target: "hub", virtual: true }, classes: "cluster-edge" },
    ],
  });
}
const hidden = (cy: cytoscape.Core) => cy.nodes(".filtered-out").map((n) => n.id()).sort();

describe("applyGraphFilter（その場で隠す絞り込み）", () => {
  it("何も指定しなければ全部見える", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "", contexts: new Set(), hideUncategorized: false });
    expect(r).toEqual({ visible: 5, hits: 0 });
    expect(hidden(cy)).toEqual([]);
  });
  it("検索はタイトルの部分一致。一致に search-hit、1 ホップは filter-context、残りは隠す", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "読書", contexts: new Set(), hideUncategorized: false });
    expect(r).toEqual({ visible: 2, hits: 1 });
    expect(cy.nodes(".search-hit").map((n) => n.id())).toEqual(["n2"]);
    expect(cy.nodes(".filter-context").map((n) => n.id())).toEqual(["s1"]);
    expect(cy.getElementById("e2").hasClass("filter-context")).toBe(true);
    expect(hidden(cy)).toEqual(["c1", "n1", "n3"]);
  });
  it("フォルダは、そのフォルダのノートを主役に、1 ホップを周辺として残す", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "", contexts: new Set(["電池"]), hideUncategorized: false });
    expect(r.visible).toBe(2);
    expect(cy.nodes(".filter-context").map((n) => n.id())).toEqual(["c1"]);
    expect(hidden(cy)).toEqual(["n2", "n3", "s1"]);
  });
  it("検索とフォルダは両方を満たすものが主役になり、不可視の射影の辺は辿らない", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "ノート", contexts: new Set(["読書"]), hideUncategorized: false });
    expect(r).toEqual({ visible: 0, hits: 0 });
    expect(hidden(cy).length).toBe(5);
    // n3 は hub と仮想辺で結ばれているが、検索「未分類」でも hub は周辺に入らない
    applyGraphFilter(cy, nodes, { query: "未分類", contexts: new Set(), hideUncategorized: false });
    expect(cy.nodes(".filter-context").length).toBe(0);
  });
  it("未分類を隠すは、フォルダを持てるのに無い通常ノートだけ消す", () => {
    const cy = make();
    applyGraphFilter(cy, nodes, { query: "", contexts: new Set(), hideUncategorized: true });
    expect(hidden(cy)).toEqual(["n3"]);
  });
  it("解除すると元に戻る（位置は触らない）", () => {
    const cy = make();
    cy.getElementById("n2").position({ x: 42, y: 7 });
    applyGraphFilter(cy, nodes, { query: "電", contexts: new Set(), hideUncategorized: false });
    applyGraphFilter(cy, nodes, { query: "", contexts: new Set(), hideUncategorized: false });
    expect(hidden(cy)).toEqual([]);
    expect(cy.getElementById("n2").position()).toEqual({ x: 42, y: 7 });
  });
});
