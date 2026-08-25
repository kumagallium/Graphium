import { describe, it, expect } from "vitest";
import { graphStructureKey } from "./graph-identity";

describe("graphStructureKey（並べ直す理由があるかの判定）", () => {
  const edges = [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ];

  it("同じ形なら同じキー", () => {
    expect(graphStructureKey(["a", "b", "c"], edges)).toBe(
      graphStructureKey(["a", "b", "c"], edges),
    );
  });

  it("並び順が違うだけなら同じキー（データの作られ方で揺れないように）", () => {
    expect(graphStructureKey(["c", "b", "a"], [edges[1], edges[0]])).toBe(
      graphStructureKey(["a", "b", "c"], edges),
    );
  });

  it("ノードが増えたら別のキー", () => {
    expect(graphStructureKey(["a", "b", "c", "d"], edges)).not.toBe(
      graphStructureKey(["a", "b", "c"], edges),
    );
  });

  it("繋がりが変わったら別のキー", () => {
    expect(graphStructureKey(["a", "b", "c"], [{ source: "a", target: "c" }])).not.toBe(
      graphStructureKey(["a", "b", "c"], edges),
    );
  });

  it("エッジの向きが逆なら別のキー", () => {
    expect(graphStructureKey(["a", "b"], [{ source: "b", target: "a" }])).not.toBe(
      graphStructureKey(["a", "b"], [{ source: "a", target: "b" }]),
    );
  });

  it("空のグラフでも落ちない", () => {
    expect(typeof graphStructureKey([], [])).toBe("string");
  });
});
