import { describe, expect, it } from "vitest";
import {
  islandCenters,
  nearestIslands,
  pickCrossIslandEdges,
  spreadIslands,
  toControlPoints,
} from "./island-edge-bundling";

describe("pickCrossIslandEdges", () => {
  const islandOf = new Map([
    ["a", "I1"],
    ["b", "I1"],
    ["c", "I2"],
  ]);

  it("両端の島が違う辺だけを返す", () => {
    const ids = pickCrossIslandEdges(
      [
        { id: "ab", source: "a", target: "b" },
        { id: "ac", source: "a", target: "c" },
      ],
      islandOf,
    );
    expect(ids).toEqual(["ac"]);
  });

  it("島の分からないノードに繋がる辺は含めない", () => {
    expect(pickCrossIslandEdges([{ id: "ax", source: "a", target: "x" }], islandOf)).toEqual([]);
  });
});

describe("spreadIslands", () => {
  it("所属の無いノードは、つながる相手の多数派の島に入る", () => {
    const islands = spreadIslands(
      [
        { source: "t1", target: "c" },
        { source: "t2", target: "c" },
        { source: "t3", target: "c" },
      ],
      new Map([
        ["t1", "A"],
        ["t2", "A"],
        ["t3", "B"],
      ]),
    );
    expect(islands.get("c")).toBe("A");
  });

  it("1 回ごとに 1 歩ずつ広がる（話題 → 知見 → ノート）", () => {
    const edges = [
      { source: "topic", target: "claim" },
      { source: "claim", target: "note" },
    ];
    const fixed = new Map([["topic", "A"]]);
    expect(spreadIslands(edges, fixed, 1).has("note")).toBe(false);
    expect(spreadIslands(edges, fixed, 2).get("note")).toBe("A");
  });

  it("元の所属は変えない", () => {
    const islands = spreadIslands(
      [
        { source: "a", target: "b" },
        { source: "c", target: "b" },
      ],
      new Map([
        ["a", "A"],
        ["b", "B"],
        ["c", "A"],
      ]),
    );
    expect(islands.get("b")).toBe("B");
  });

  it("同数なら島 id の小さい方に入る", () => {
    const islands = spreadIslands(
      [
        { source: "x", target: "n" },
        { source: "y", target: "n" },
      ],
      new Map([
        ["x", "B"],
        ["y", "A"],
      ]),
    );
    expect(islands.get("n")).toBe("A");
  });
});

describe("islandCenters / nearestIslands", () => {
  const positions = new Map([
    ["a1", { x: 0, y: 0 }],
    ["a2", { x: 10, y: 0 }],
    ["b1", { x: 100, y: 0 }],
    ["free", { x: 90, y: 0 }],
  ]);
  const fixed = new Map([
    ["a1", "A"],
    ["a2", "A"],
    ["b1", "B"],
  ]);

  it("島の中心は所属するノードの位置の平均", () => {
    const centers = islandCenters(positions, fixed);
    expect(centers.get("A")).toEqual({ x: 5, y: 0 });
    expect(centers.get("B")).toEqual({ x: 100, y: 0 });
  });

  it("所属の無いノードは一番近い中心の島に入り、元の所属は変えない", () => {
    const islands = nearestIslands(positions, islandCenters(positions, fixed), fixed);
    expect(islands.get("free")).toBe("B");
    expect(islands.get("a2")).toBe("A");
  });

  it("島が 1 つも無ければ元の所属をそのまま返す", () => {
    expect(nearestIslands(positions, new Map(), fixed)).toEqual(fixed);
  });
});

describe("toControlPoints", () => {
  const s = { x: 0, y: 0 };
  const t = { x: 100, y: 0 };

  it("線上の位置の割合と垂直距離に変える", () => {
    // (-dy, dx) = (0, 100) の向き（y が増える側）が正
    const { distances, weights } = toControlPoints([s, { x: 50, y: 20 }, t], s, t);
    expect(weights).toEqual([0.5]);
    expect(distances[0]).toBeCloseTo(20);
  });

  it("反対側は負になる", () => {
    const { distances } = toControlPoints([s, { x: 50, y: -20 }, t], s, t);
    expect(distances[0]).toBeCloseTo(-20);
  });

  it("内点から等間隔に指定した数だけ拾う", () => {
    const path = Array.from({ length: 17 }, (_, i) => ({ x: i * 6.25, y: 0 }));
    const { weights } = toControlPoints(path, s, t, 7);
    expect(weights).toHaveLength(7);
    // 小さい順に並ぶ（線上を source から target へ）
    expect([...weights].sort((a, b) => a - b)).toEqual(weights);
  });

  it("長さ 0 の辺や点が 2 つだけの線は制御点を作らない", () => {
    expect(toControlPoints([s, s, s], s, s).distances).toEqual([]);
    expect(toControlPoints([s, t], s, t).distances).toEqual([]);
  });
});
