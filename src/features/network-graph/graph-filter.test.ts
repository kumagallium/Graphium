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
  it("検索はタイトルの部分一致で、一致しないノードを隠し、一致に search-hit を付ける", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "電", contexts: new Set(), hideUncategorized: false });
    expect(r).toEqual({ visible: 2, hits: 2 });
    expect(hidden(cy)).toEqual(["n2", "n3", "s1"]);
    expect(cy.nodes(".search-hit").map((n) => n.id()).sort()).toEqual(["c1", "n1"]);
  });
  it("フォルダは、そのフォルダのノートと、それに直接つながる知見・原料を残す", () => {
    const cy = make();
    const r = applyGraphFilter(cy, nodes, { query: "", contexts: new Set(["電池"]), hideUncategorized: false });
    expect(r.visible).toBe(2);
    expect(hidden(cy)).toEqual(["n2", "n3", "s1"]);
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
