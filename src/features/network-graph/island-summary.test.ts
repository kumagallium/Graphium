// island-summary.ts の検証。
// 所属（community → 隣接の多数派 → 衛星は親）、島の足切り、代表・資料の順位、件数。

import { describe, expect, it } from "vitest";
import { summarizeIslands } from "./island-summary";
import type { NoteGraphData, NoteNode } from "./graph-builder";

function topic(id: string, title = id): NoteNode {
  return { id, title, isCurrent: false, hop: 0, isWiki: true, wikiKind: "topic" };
}
function claim(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" };
}
function external(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, external: "pdf" };
}
const edge = (source: string, target: string) => ({ source, target, relation: "derived" as const });

describe("summarizeIslands", () => {
  // 島 A: 話題 t1, t2（資料 s1 を共有、t1 には知見 c1・c2）
  // 島 B: 話題 t3 だけ（中心の種類が 1 件なので島として扱わない）
  const data: NoteGraphData = {
    nodes: [topic("t1", "熱電材料"), topic("t2", "焼結"), topic("t3"), external("s1"), external("s2"), claim("c1"), claim("c2")],
    edges: [edge("s1", "t1"), edge("s1", "t2"), edge("s2", "t2"), edge("c1", "t1"), edge("c2", "t1"), edge("c1", "c2")],
  };
  const communities = new Map([
    ["t1", "A"],
    ["t2", "A"],
    ["t3", "B"],
  ]);
  const focusIds = new Set(["t1", "t2", "t3"]);

  it("中心の種類が 2 件以上の島だけを返す", () => {
    const r = summarizeIslands(data, communities, { focusIds });
    expect(r.map((s) => s.id)).toEqual(["A"]);
  });

  it("community に無いノードは隣接の多数派の島に入り、件数に数える", () => {
    const [a] = summarizeIslands(data, communities, { focusIds });
    expect(new Set(a.memberIds)).toEqual(new Set(["t1", "t2", "s1", "s2", "c1", "c2"]));
    expect(a.counts).toEqual({ topic: 2, external: 2, claim: 2 });
  });

  it("代表は島の中のつながりが多い順", () => {
    const [a] = summarizeIslands(data, communities, { focusIds });
    // t1: s1, c1, c2 = 3 / t2: s1, s2 = 2
    expect(a.representatives.map((m) => [m.title, m.score])).toEqual([
      ["熱電材料", 3],
      ["焼結", 2],
    ]);
  });

  it("資料は島の中で引かれている数が多い順", () => {
    const [a] = summarizeIslands(data, communities, { focusIds });
    expect(a.topSources.map((m) => [m.id, m.score])).toEqual([
      ["s1", 2],
      ["s2", 1],
    ]);
  });

  it("畳んだ葉（衛星）は親の島に入り、親のつながりとして数える", () => {
    const leaves = [claim("c3"), claim("c4"), claim("c5")];
    const foldedInto = new Map(leaves.map((n) => [n.id, "t2"]));
    // 別の島（B）の話題の衛星は、A の芯に入らない
    leaves.push(claim("c9"));
    foldedInto.set("c9", "t3");
    const [a] = summarizeIslands(data, communities, { focusIds, foldedOutNodes: leaves, foldedInto });
    expect(a.counts.claim).toBe(5);
    // 芯（位置用）は中心の種類＋その衛星だけ。隣接から広げた資料・知見は入らない
    expect(new Set(a.anchorIds)).toEqual(new Set(["t1", "t2", "c3", "c4", "c5"]));
    // t2: s1, s2, c3, c4, c5 = 5 が t1 の 3 を抜く
    expect(a.representatives[0].id).toBe("t2");
  });

  it("隣接が同数のときは文字列順で小さい島に入る", () => {
    const d: NoteGraphData = {
      nodes: [topic("a1"), topic("a2"), topic("b1"), topic("b2"), external("x")],
      edges: [edge("x", "a1"), edge("x", "b1"), edge("a1", "a2"), edge("b1", "b2")],
    };
    const c = new Map([
      ["a1", "B"],
      ["a2", "B"],
      ["b1", "A"],
      ["b2", "A"],
    ]);
    const r = summarizeIslands(d, c, { focusIds: new Set(["a1", "a2", "b1", "b2"]) });
    const islandA = r.find((s) => s.id === "A")!;
    expect(islandA.memberIds).toContain("x");
  });

  it("所属は段ごとに外へ広がる（話題 → 知見 → 知見の元のノート）", () => {
    const n1: NoteNode = { id: "n1", title: "n1", isCurrent: false, hop: 0 };
    const d: NoteGraphData = { nodes: [...data.nodes, n1], edges: [...data.edges, edge("n1", "c1")] };
    const [a] = summarizeIslands(d, communities, { focusIds });
    expect(a.memberIds).toContain("n1");
    expect(a.counts.note).toBe(1);
  });

  it("件数の上限で代表・資料を切る", () => {
    const [a] = summarizeIslands(data, communities, { focusIds, maxRepresentatives: 1, maxSources: 1 });
    expect(a.representatives).toHaveLength(1);
    expect(a.topSources).toHaveLength(1);
  });
});
