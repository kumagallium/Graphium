// global-graph-structure.ts の検証。
// foldLeafNodes: ノート隣接数（0/1/2以上）で畳む・取り除く・残す規則。
// computeReachScores: hops 以内で届く別のノートの数。

import { describe, expect, it } from "vitest";
import { foldLeafNodes, computeReachScores } from "./global-graph-structure";
import type { NoteGraphData, NoteNode } from "./graph-builder";

function note(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0 };
}
function claim(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, isWiki: true, wikiKind: "claim" };
}
function topic(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, isWiki: true, wikiKind: "topic" };
}

describe("foldLeafNodes", () => {
  it("ノート隣接1の知見3つが1つのノートに畳まれ、countが3になる", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), claim("c1"), claim("c2"), claim("c3")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "n1", target: "c2", relation: "derived" },
        { source: "n1", target: "c3", relation: "derived" },
      ],
    };
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(["n1"]);
    expect(folded.edges).toHaveLength(0);
    expect(foldedCount.get("n1")).toBe(3);
    expect(foldedTotal).toBe(3);
  });

  it("2 ノートに繋がる知見は残る（ノートをまたぐ橋）", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), claim("c1")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "n2", target: "c1", relation: "derived" },
      ],
    };
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(["c1", "n1", "n2"]);
    expect(folded.edges).toHaveLength(2);
    expect(foldedCount.size).toBe(0);
    expect(foldedTotal).toBe(0);
  });

  it("ノートはノート隣接数に関わらず畳まれない", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2")],
      edges: [{ source: "n1", target: "n2", relation: "derived" }],
    };
    const { data: folded, foldedCount } = foldLeafNodes(data);
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(foldedCount.size).toBe(0);
  });

  it("話題に繋がっている知見でもノート隣接が1なら畳む", () => {
    // c1: ノート隣接は n1 のみ（t1 はノートではない）→ noteNeighbors.size === 1 → n1 に畳む
    // t1: ノート隣接は 0（隣接は c1 のみ）→ 取り除くが特定の相手には畳まない
    const data: NoteGraphData = {
      nodes: [note("n1"), claim("c1"), topic("t1")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "c1", target: "t1", relation: "derived" },
      ],
    };
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(["n1"]);
    expect(folded.edges).toHaveLength(0);
    expect(foldedCount.get("n1")).toBe(1); // c1 が畳まれた
    expect(foldedTotal).toBe(2); // c1（畳まれた）+ t1（取り除かれた）
  });

  it("ノート隣接0の話題は消えて foldedTotal に入る（特定の相手には畳まない）", () => {
    const data: NoteGraphData = {
      nodes: [claim("c1"), claim("c2"), topic("t1")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c2", target: "t1", relation: "derived" },
      ],
    };
    // c1, c2, t1 いずれもノート隣接は 0（互いに繋がっているだけ）→ すべて取り除かれる
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes).toHaveLength(0);
    expect(folded.edges).toHaveLength(0);
    expect(foldedCount.size).toBe(0);
    expect(foldedTotal).toBe(3);
  });

  it("ノート隣接0の知見ペア（知見同士が1本だけで繋がる）は両方とも取り除かれ foldedTotal に2が入る", () => {
    // c1—c2 のみで、どちらもノートに繋がっていない。互いの唯一の隣接は
    // ノートではない（相手も知見）ので noteNeighbors.size === 0 → 両方取り除かれる
    // （特定の相手には畳まない＝foldedCount は増えず、foldedTotal だけ 2 になる）。
    const data: NoteGraphData = {
      nodes: [claim("c1"), claim("c2")],
      edges: [{ source: "c1", target: "c2", relation: "derived" }],
    };
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes).toHaveLength(0);
    expect(folded.edges).toHaveLength(0);
    expect(foldedCount.size).toBe(0);
    expect(foldedTotal).toBe(2);
  });

  it("1 回の走査で決める（畳んだ結果を使って連鎖判定しない）", () => {
    // n1—c1—c2 という並び。c1 のノート隣接は n1 のみ（1）→ n1 に畳む。
    // c2 のノート隣接は 0（隣接は c1 のみ、ノートではない）→ 取り除かれる（畳まない）。
    // 元データの隣接関係で同時に判定するので、c1 を畳んだ後に c2 が「n1 に繋がった」
    // ことにはならない。
    const data: NoteGraphData = {
      nodes: [note("n1"), claim("c1"), claim("c2")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "c1", target: "c2", relation: "derived" },
      ],
    };
    const { data: folded, foldedCount, foldedTotal } = foldLeafNodes(data);
    expect(folded.nodes.map((n) => n.id).sort()).toEqual(["n1"]);
    expect(foldedCount.get("n1")).toBe(1);
    expect(foldedTotal).toBe(2);
  });
});

describe("computeReachScores", () => {
  it("直線 n1—n2—n3 で n2=2, n1=1（hops=2なら n1 から n3 も届いて 2）", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), note("n3")],
      edges: [
        { source: "n1", target: "n2", relation: "derived" },
        { source: "n2", target: "n3", relation: "derived" },
      ],
    };
    const scores = computeReachScores(data, { hops: 2 });
    expect(scores.get("n1")).toBe(2);
    expect(scores.get("n2")).toBe(2);
    expect(scores.get("n3")).toBe(2);
  });

  it("直線 n1—n2—n3 で hops=1 なら n1=1, n2=2, n3=1", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), note("n3")],
      edges: [
        { source: "n1", target: "n2", relation: "derived" },
        { source: "n2", target: "n3", relation: "derived" },
      ],
    };
    const scores = computeReachScores(data, { hops: 1 });
    expect(scores.get("n1")).toBe(1);
    expect(scores.get("n2")).toBe(2);
    expect(scores.get("n3")).toBe(1);
  });

  it("知見を介した2ノート（n1→c→n2）は互いに1", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), claim("c1")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "n2", target: "c1", relation: "derived" },
      ],
    };
    const scores = computeReachScores(data, { hops: 2 });
    expect(scores.get("n1")).toBe(1);
    expect(scores.get("n2")).toBe(1);
    expect(scores.has("c1")).toBe(false);
  });

  it("外れたノートは0", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2")],
      edges: [],
    };
    const scores = computeReachScores(data);
    expect(scores.get("n1")).toBe(0);
    expect(scores.get("n2")).toBe(0);
  });
});
