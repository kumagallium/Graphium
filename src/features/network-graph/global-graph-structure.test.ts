// global-graph-structure.ts の検証。
// foldLeafNodes: ノート隣接数（0/1/2以上）で畳む・取り除く・残す規則。
// computeReachScores: hops 以内で届く別のノートの数。
// assignIslands: reach の高いノートをハブにし、他のノートを最も近いハブに割り当てる。

import { describe, expect, it } from "vitest";
import {
  foldLeafNodes,
  computeReachScores,
  computeTopicReachScores,
  computeFocusFoldResult,
  assignIslands,
  detectCommunities,
  detectNoteCommunities,
  detectFocusCommunities,
  analyzeCrystalIslands,
} from "./global-graph-structure";
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
function external(id: string): NoteNode {
  return { id, title: id, isCurrent: false, hop: 0, external: "pdf" };
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

  it("focus が note 以外（crystal/source）のとき、フォーカス隣接 0 のノードは取り除かれず残る", () => {
    // n1・n2 はどちらもノート（crystal/source どちらのフォーカス種類でもない）。
    // 互いにしか繋がっていないので、フォーカス隣接は 0。
    // focus="crystal"/"source" では橋として残す（後始末の幾何配置で位置を
    // 決めるため。取り除くと孤立の既定位置に取り残されてしまう事故の元だった）。
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2")],
      edges: [{ source: "n1", target: "n2", relation: "derived" }],
    };
    const crystalResult = foldLeafNodes(data, { focus: "crystal" });
    expect(crystalResult.data.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(crystalResult.foldedTotal).toBe(0);

    const sourceResult = foldLeafNodes(data, { focus: "source" });
    expect(sourceResult.data.nodes.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    expect(sourceResult.foldedTotal).toBe(0);

    // 対比: focus="note"（既定）ではノート以外（ここでは external）の
    // フォーカス隣接 0 は今までどおり取り除かれる。
    const dataWithExternal: NoteGraphData = {
      nodes: [note("n1"), external("s1")],
      edges: [], // s1 はどのノートにも used されていない
    };
    const noteResult = foldLeafNodes(dataWithExternal);
    expect(noteResult.data.nodes.map((n) => n.id)).toEqual(["n1"]);
    expect(noteResult.foldedTotal).toBe(1);
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

describe("computeTopicReachScores", () => {
  it("直線 t1—c1—t2—c2—t3 で t2=2、t1/t3 は既定 hops=2 なら 1、hops を伸ばすと 2", () => {
    const data: NoteGraphData = {
      nodes: [topic("t1"), claim("c1"), topic("t2"), claim("c2"), topic("t3")],
      edges: [
        { source: "t1", target: "c1", relation: "derived" },
        { source: "c1", target: "t2", relation: "derived" },
        { source: "t2", target: "c2", relation: "derived" },
        { source: "c2", target: "t3", relation: "derived" },
      ],
    };
    const scores = computeTopicReachScores(data); // 既定 hops=2
    expect(scores.get("t2")).toBe(2); // t1・t3 とも depth2 で届く
    expect(scores.get("t1")).toBe(1); // t2 だけ（t3 は depth4 で届かない）
    expect(scores.get("t3")).toBe(1);

    const wideScores = computeTopicReachScores(data, { hops: 4 });
    expect(wideScores.get("t1")).toBe(2); // t2（depth2）・t3（depth4）とも届く
  });
});

describe("assignIslands", () => {
  it("2 つの鎖にそれぞれハブがあれば鎖ごとに分かれる", () => {
    // h1-x1-x2-x3（鎖1）と h2-y1-y2-y3（鎖2）は互いに繋がっていない。
    // h1, h2 だけ reach が高い（候補かつハブ候補間で 2 ホップ以内に隣接しないので残る）。
    const data: NoteGraphData = {
      nodes: [note("h1"), note("x1"), note("x2"), note("x3"), note("h2"), note("y1"), note("y2"), note("y3")],
      edges: [
        { source: "h1", target: "x1", relation: "derived" },
        { source: "x1", target: "x2", relation: "derived" },
        { source: "x2", target: "x3", relation: "derived" },
        { source: "h2", target: "y1", relation: "derived" },
        { source: "y1", target: "y2", relation: "derived" },
        { source: "y2", target: "y3", relation: "derived" },
      ],
    };
    const reachScores = new Map<string, number>([
      ["h1", 10],
      ["x1", 1],
      ["x2", 1],
      ["x3", 1],
      ["h2", 10],
      ["y1", 1],
      ["y2", 1],
      ["y3", 1],
    ]);
    const assignment = assignIslands(data, reachScores);
    expect(assignment.get("h1")).toBe("h1");
    expect(assignment.get("x1")).toBe("h1");
    expect(assignment.get("x2")).toBe("h1");
    expect(assignment.get("x3")).toBe("h1");
    expect(assignment.get("h2")).toBe("h2");
    expect(assignment.get("y1")).toBe("h2");
    expect(assignment.get("y2")).toBe("h2");
    expect(assignment.get("y3")).toBe("h2");
  });

  it("同距離なら reach の高い方に割り当てる", () => {
    // A-a1-m-b1-B: A と B は 4 ホップ離れているので 2 ホップ以内の間引きに
    // 引っかからず両方ハブとして残る。m は A・B のどちらからも 2 ホップで、
    // reach の高い A（10）に割り当てられるはず（B は 8）。
    const data: NoteGraphData = {
      nodes: [note("A"), note("a1"), note("m"), note("b1"), note("B")],
      edges: [
        { source: "A", target: "a1", relation: "derived" },
        { source: "a1", target: "m", relation: "derived" },
        { source: "m", target: "b1", relation: "derived" },
        { source: "b1", target: "B", relation: "derived" },
      ],
    };
    const reachScores = new Map<string, number>([
      ["A", 10],
      ["a1", 1],
      ["m", 1],
      ["b1", 1],
      ["B", 8],
    ]);
    const assignment = assignIslands(data, reachScores);
    expect(assignment.get("A")).toBe("A");
    expect(assignment.get("B")).toBe("B");
    expect(assignment.get("m")).toBe("A");
  });

  it("届かないノートは Map に無い", () => {
    // far は他のどのノードとも繋がっていない孤立ノート。ハブ（h）からの
    // BFS が 3 ホップ以内に届かないので割り当てられない。
    const data: NoteGraphData = {
      nodes: [note("h"), note("x1"), note("far")],
      edges: [{ source: "h", target: "x1", relation: "derived" }],
    };
    const reachScores = new Map<string, number>([
      ["h", 10],
      ["x1", 1],
      ["far", 1],
    ]);
    const assignment = assignIslands(data, reachScores);
    expect(assignment.get("h")).toBe("h");
    expect(assignment.get("x1")).toBe("h");
    expect(assignment.has("far")).toBe(false);
  });
});

describe("detectCommunities", () => {
  it("2 つの鎖（それぞれ 4 ノート、間に辺なし）が 2 つのラベルに分かれる", () => {
    const data: NoteGraphData = {
      nodes: [note("p1"), note("p2"), note("p3"), note("p4"), note("q1"), note("q2"), note("q3"), note("q4")],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "p3", target: "p4", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "q3", target: "q4", relation: "derived" },
      ],
    };
    const labels = detectCommunities(data);
    const pLabel = labels.get("p1");
    const qLabel = labels.get("q1");
    expect(labels.get("p2")).toBe(pLabel);
    expect(labels.get("p3")).toBe(pLabel);
    expect(labels.get("p4")).toBe(pLabel);
    expect(labels.get("q2")).toBe(qLabel);
    expect(labels.get("q3")).toBe(qLabel);
    expect(labels.get("q4")).toBe(qLabel);
    expect(pLabel).not.toBe(qLabel);
  });

  it("三角形+1本の橋で繋がった2つの三角形が2つに分かれる", () => {
    // 橋は各三角形の中で id が最も大きいノード（p3, q3）どうしを繋ぐ。
    // 三角形内の他 2 ノードは既にその三角形のラベルに揃った後で橋ノードが
    // 処理されるので、橋の 1 票は 2 票の内輪多数決に負ける（同数のタイに
    // ならない）。
    const data: NoteGraphData = {
      nodes: [note("p1"), note("p2"), note("p3"), note("q1"), note("q2"), note("q3")],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p1", target: "p3", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q1", target: "q3", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "p3", target: "q3", relation: "reference" },
      ],
    };
    const labels = detectCommunities(data);
    const pLabel = labels.get("p1");
    const qLabel = labels.get("q1");
    expect(labels.get("p2")).toBe(pLabel);
    expect(labels.get("p3")).toBe(pLabel);
    expect(labels.get("q2")).toBe(qLabel);
    expect(labels.get("q3")).toBe(qLabel);
    expect(pLabel).not.toBe(qLabel);
  });

  it("孤立ノードは単独（自分の id のまま）", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), note("solo")],
      edges: [{ source: "n1", target: "n2", relation: "derived" }],
    };
    const labels = detectCommunities(data);
    expect(labels.get("solo")).toBe("solo");
  });

  it("実行が決定的（2 回呼んで同じ結果）", () => {
    const data: NoteGraphData = {
      nodes: [note("p1"), note("p2"), note("p3"), note("q1"), note("q2"), note("q3")],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p1", target: "p3", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q1", target: "q3", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "p3", target: "q3", relation: "reference" },
      ],
    };
    const first = detectCommunities(data);
    const second = detectCommunities(data);
    expect([...second.entries()]).toEqual([...first.entries()]);
  });
});

describe("detectNoteCommunities", () => {
  it("2 系列のノートが共有知見 1 つで繋がっていても 2 つの島のまま", () => {
    // c1 は p1・q1 の両方に繋がる共有知見だが、ノート同士の辺だけでラベル伝播
    // するので c1 経由で 2 系列がくっつくことはない。
    const data: NoteGraphData = {
      nodes: [
        note("p1"), note("p2"), note("p3"), note("p4"),
        note("q1"), note("q2"), note("q3"), note("q4"),
        claim("c1"),
      ],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "p3", target: "p4", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "q3", target: "q4", relation: "derived" },
        { source: "p1", target: "c1", relation: "derived" },
        { source: "q1", target: "c1", relation: "derived" },
      ],
    };
    const communities = detectNoteCommunities(data);
    const pLabel = communities.get("p1");
    const qLabel = communities.get("q1");
    expect(communities.get("p4")).toBe(pLabel);
    expect(communities.get("q4")).toBe(qLabel);
    expect(pLabel).not.toBe(qLabel);
  });

  it("共有知見は隣接ノートの多い方の島に所属する", () => {
    const data: NoteGraphData = {
      nodes: [
        note("p1"), note("p2"), note("p3"), note("p4"),
        note("q1"), note("q2"), note("q3"), note("q4"),
        claim("c1"),
      ],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "p3", target: "p4", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "q3", target: "q4", relation: "derived" },
        // c1 は p 系列に 2 本、q 系列に 1 本 → p 系列の島に所属する
        { source: "p1", target: "c1", relation: "derived" },
        { source: "p2", target: "c1", relation: "derived" },
        { source: "q1", target: "c1", relation: "derived" },
      ],
    };
    const communities = detectNoteCommunities(data);
    expect(communities.get("c1")).toBe(communities.get("p1"));
  });

  it("孤立知見（ノートに隣接しない）は Map に無い", () => {
    // c2 は c1 経由でしか繋がっておらず、ノートに直接隣接しない
    const data: NoteGraphData = {
      nodes: [note("n1"), claim("c1"), claim("c2")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "c1", target: "c2", relation: "derived" },
      ],
    };
    const communities = detectNoteCommunities(data);
    expect(communities.get("c1")).toBe(communities.get("n1"));
    expect(communities.has("c2")).toBe(false);
  });
});

describe("detectFocusCommunities", () => {
  it("crystal フォーカス: 知見を共有する話題2つは同じ島", () => {
    // t1・t2 は知見 c1 を共有する（射影の辺で繋がる）ので同じ島になる。
    // 物理配置に参加するのは話題だけなので、島は話題どうしのグラフで決まる。
    const data: NoteGraphData = {
      nodes: [topic("t1"), topic("t2"), claim("c1")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c1", target: "t2", relation: "derived" },
      ],
    };
    const communities = detectFocusCommunities(data, "crystal");
    expect(communities.get("t1")).toBe(communities.get("t2"));
  });

  it("source フォーカス: 同じノートで使われた原料2つが同じ島", () => {
    const data: NoteGraphData = {
      nodes: [note("n1"), note("n2"), external("s1"), external("s2"), external("s3")],
      edges: [
        { source: "s1", target: "n1", relation: "used" },
        { source: "s2", target: "n1", relation: "used" },
        { source: "s3", target: "n2", relation: "used" },
      ],
    };
    const communities = detectFocusCommunities(data, "source");
    expect(communities.get("s1")).toBe(communities.get("s2"));
    expect(communities.get("s3")).not.toBe(communities.get("s1"));
  });

  it("非フォーカスのノードは隣接するフォーカスノードの多数派の島に所属する（focus: note）", () => {
    // detectFocusCommunities(data, "note") は detectNoteCommunities と同じ規則。
    // focus が "note" のときは共有隣接による射影を使わないので、c1（知見。
    // 非フォーカス）が p 系列に 2 本・q 系列に 1 本繋がっても、p・q 各系列の
    // コミュニティ自体はそれぞれの直接のノート間の辺だけで決まり、崩れない。
    const data: NoteGraphData = {
      nodes: [note("p1"), note("p2"), note("p3"), note("q1"), note("q2"), note("q3"), claim("c1")],
      edges: [
        { source: "p1", target: "p2", relation: "derived" },
        { source: "p1", target: "p3", relation: "derived" },
        { source: "p2", target: "p3", relation: "derived" },
        { source: "q1", target: "q2", relation: "derived" },
        { source: "q1", target: "q3", relation: "derived" },
        { source: "q2", target: "q3", relation: "derived" },
        { source: "p1", target: "c1", relation: "derived" },
        { source: "p2", target: "c1", relation: "derived" },
        { source: "q1", target: "c1", relation: "derived" },
      ],
    };
    const communities = detectFocusCommunities(data, "note");
    const pLabel = communities.get("p1");
    const qLabel = communities.get("q1");
    expect(communities.get("p2")).toBe(pLabel);
    expect(communities.get("q2")).toBe(qLabel);
    expect(pLabel).not.toBe(qLabel);
    expect(communities.get("c1")).toBe(pLabel); // p 系列に 2 本・q 系列に 1 本 → 多数派の p
  });
});

describe("analyzeCrystalIslands", () => {
  it("葉知見は衛星として親が話題になる（ノートより話題を優先）", () => {
    // c1 は隣接ノート 1 つ・隣接話題 1 つ（隣接話題は 2 未満）→ 葉知見。
    // 話題があるので親は話題（ノートではなく）。
    const data: NoteGraphData = {
      nodes: [note("n1"), claim("c1"), topic("t1")],
      edges: [
        { source: "n1", target: "c1", relation: "derived" },
        { source: "c1", target: "t1", relation: "derived" },
      ],
    };
    const { leafParent, topicIds } = analyzeCrystalIslands(data);
    expect(leafParent.get("c1")).toBe("t1");
    expect(topicIds.has("c1")).toBe(false); // 話題以外は物理配置に参加しない
  });

  it("隣接話題が2つ以上の知見は共有知見として扱われる（衛星にならない）", () => {
    const data: NoteGraphData = {
      nodes: [topic("t1"), topic("t2"), claim("c1")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c1", target: "t2", relation: "derived" },
      ],
    };
    const { leafParent, sharedClaimIds } = analyzeCrystalIslands(data);
    expect(sharedClaimIds.has("c1")).toBe(true);
    expect(leafParent.has("c1")).toBe(false);
  });

  it("話題2つが知見1つを共有すると射影の辺がある", () => {
    const data: NoteGraphData = {
      nodes: [topic("t1"), topic("t2"), claim("c1")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c1", target: "t2", relation: "derived" },
      ],
    };
    const { topicEdges } = analyzeCrystalIslands(data);
    const edge = topicEdges.find(
      (e) => (e.source === "t1" && e.target === "t2") || (e.source === "t2" && e.target === "t1"),
    );
    expect(edge).toBeDefined();
    expect(edge?.sharedCount).toBe(1);
  });

  it("知見を共有しなければ話題どうしの射影の辺は無い", () => {
    const data: NoteGraphData = {
      nodes: [topic("t1"), topic("t2"), claim("c1"), claim("c2")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c2", target: "t2", relation: "derived" },
      ],
    };
    const { topicEdges } = analyzeCrystalIslands(data);
    const edge = topicEdges.find(
      (e) => (e.source === "t1" && e.target === "t2") || (e.source === "t2" && e.target === "t1"),
    );
    expect(edge).toBeUndefined();
  });

  it("話題0件・ノート0件・辺0本の空データでも例外にならない", () => {
    const data: NoteGraphData = { nodes: [], edges: [] };
    expect(() => analyzeCrystalIslands(data)).not.toThrow();
    const result = analyzeCrystalIslands(data);
    expect(result.topicIds.size).toBe(0);
    expect(result.topicEdges).toHaveLength(0);
    expect(result.communities.size).toBe(0);
    expect(result.sharedClaimIds.size).toBe(0);
    expect(result.leafParent.size).toBe(0);
    expect(result.unplaced.size).toBe(0);
  });

  it("話題も持たずノートにも隣接しない知見（知見同士だけで繋がる）は unplaced に入る", () => {
    // c1—c2 は知見同士だけで繋がっており、どちらも話題・ノートに隣接しない。
    const data: NoteGraphData = {
      nodes: [claim("c1"), claim("c2")],
      edges: [{ source: "c1", target: "c2", relation: "derived" }],
    };
    const { unplaced, sharedClaimIds, leafParent } = analyzeCrystalIslands(data);
    expect(unplaced.has("c1")).toBe(true);
    expect(unplaced.has("c2")).toBe(true);
    expect(sharedClaimIds.size).toBe(0);
    expect(leafParent.size).toBe(0);
  });
});

describe("computeFocusFoldResult", () => {
  it('focus: "crystal" は葉知見を話題に畳み、共有知見は残す', () => {
    // c1: t1 のみ（葉知見）→ 畳まれる。c2: t1・t2（共有知見）→ 残る。
    const data: NoteGraphData = {
      nodes: [topic("t1"), topic("t2"), claim("c1"), claim("c2")],
      edges: [
        { source: "c1", target: "t1", relation: "derived" },
        { source: "c2", target: "t1", relation: "derived" },
        { source: "c2", target: "t2", relation: "derived" },
      ],
    };
    const result = computeFocusFoldResult(data, "crystal");
    expect(result.data.nodes.map((n) => n.id).sort()).toEqual(["c2", "t1", "t2"]);
    expect(result.foldedInto.get("c1")).toBe("t1");
    expect(result.foldedCount.get("t1")).toBe(1);
    expect(result.foldedTotal).toBe(1);
  });
});
