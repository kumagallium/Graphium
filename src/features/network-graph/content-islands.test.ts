// content-islands.ts と、analyzeCrystalIslands の「内容の島」の検証。
// 結び方（相互 k 近傍＋最近傍 1 本・下限）、重心順、つながりへの戻し方。

import { describe, expect, it } from "vitest";
import { buildContentTopicEdges, rankByCentroid } from "./content-islands";
import { analyzeCrystalIslands } from "./global-graph-structure";
import type { NoteGraphData, NoteNode } from "./graph-builder";

function topic(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, isWiki: true, wikiKind: "topic" };
}
function external(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, external: "pdf" };
}
const edge = (source: string, target: string) => ({ source, target, relation: "derived" as const });
const pairs = (edges: { source: string; target: string }[]) =>
  edges.map((e) => [e.source, e.target].sort().join("-")).sort();

// 2 つのテーマ（x 軸寄り・y 軸寄り）
const vectors = new Map<string, number[]>([
  ["a1", [1, 0.1, 0]],
  ["a2", [1, 0.2, 0]],
  ["a3", [0.9, 0.15, 0]],
  ["b1", [0.1, 1, 0]],
  ["b2", [0.2, 1, 0]],
]);

describe("buildContentTopicEdges", () => {
  it("同じテーマの話題だけを結び、テーマをまたがない", () => {
    const edges = buildContentTopicEdges(["a1", "a2", "a3", "b1", "b2"], vectors, { k: 2 });
    expect(pairs(edges)).toEqual(["a1-a2", "a1-a3", "a2-a3", "b1-b2"]);
  });

  it("下限未満の組は最近傍でも結ばない", () => {
    const v = new Map<string, number[]>([
      ["p", [1, 0]],
      ["q", [0, 1]],
    ]);
    expect(buildContentTopicEdges(["p", "q"], v, { minSimilarity: 0.5 })).toEqual([]);
  });

  it("ベクトルの無い話題は含めない", () => {
    const edges = buildContentTopicEdges(["a1", "a2", "z"], vectors);
    expect(edges.every((e) => e.source !== "z" && e.target !== "z")).toBe(true);
  });

  it("相互でない近傍は結ばず、ハブを介した連鎖を作らない", () => {
    // h は全員に近い（ハブ）。k=1 だと各自の最近傍は h だが、h の最近傍は 1 つだけ
    const v = new Map<string, number[]>([
      ["h", [1, 1, 1]],
      ["x", [1, 0.9, 0.2]],
      ["y", [0.2, 1, 0.9]],
    ]);
    const edges = buildContentTopicEdges(["h", "x", "y"], v, { k: 1, minSimilarity: 0.5 });
    // 各自の最近傍 1 本（x-h, y-h）は結ぶが、x-y は結ばない
    expect(pairs(edges)).toEqual(["h-x", "h-y"]);
  });
});

describe("rankByCentroid", () => {
  it("重心に近い順に並べ、ベクトルの無いものは末尾", () => {
    const r = rankByCentroid(["z", "a1", "a3", "a2"], vectors);
    expect(r[r.length - 1]).toBe("z");
    expect(new Set(r.slice(0, 3))).toEqual(new Set(["a1", "a2", "a3"]));
  });
});

describe("analyzeCrystalIslands（内容の島）", () => {
  // つながりでは a1 と b1 が同じ資料 s を引いているが、内容は別のテーマ
  const data: NoteGraphData = {
    nodes: ["a1", "a2", "a3", "b1", "b2"].map(topic).concat([external("s")]),
    edges: [edge("s", "a1"), edge("s", "b1")],
  };

  it("埋め込みを渡すと内容で島に分ける", () => {
    const r = analyzeCrystalIslands(data, { topicVectors: vectors });
    expect(r.grouping).toBe("content");
    const c = r.communities;
    expect(c.get("a1")).toBe(c.get("a2"));
    expect(c.get("a1")).toBe(c.get("a3"));
    expect(c.get("b1")).toBe(c.get("b2"));
    expect(c.get("a1")).not.toBe(c.get("b1"));
  });

  it("埋め込みが無ければつながりの島のまま", () => {
    const r = analyzeCrystalIslands(data);
    expect(r.grouping).toBe("connection");
    expect(r.communities.get("a1")).toBe(r.communities.get("b1"));
  });

  it("ベクトルのある話題が半分未満なら、つながりに戻す", () => {
    const few = new Map([["a1", vectors.get("a1")!], ["a2", vectors.get("a2")!]]);
    expect(analyzeCrystalIslands(data, { topicVectors: few }).grouping).toBe("connection");
  });

  it("ベクトルの無い話題は、つながりの辺で隣の島に入る", () => {
    const d: NoteGraphData = {
      nodes: [...data.nodes, topic("n1"), external("t")],
      edges: [...data.edges, edge("t", "n1"), edge("t", "b2")],
    };
    const r = analyzeCrystalIslands(d, { topicVectors: vectors });
    expect(r.grouping).toBe("content");
    expect(r.communities.get("n1")).toBe(r.communities.get("b2"));
  });
});
