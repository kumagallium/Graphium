// RRF のテスト
// - 両リストの上位に居るものが最上位
// - 片方のリストにしか無い候補も残る（空リストは無視される）
// - 重みで一方を強くできる。同一リスト内の重複は最初の順位だけ

import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "./fuse";

describe("reciprocalRankFusion", () => {
  it("両方で上位のものが最上位になり、片方だけの候補も残る", () => {
    const fused = reciprocalRankFusion([
      { name: "dense", items: [{ id: "a", score: 0.9 }, { id: "b", score: 0.8 }, { id: "c", score: 0.7 }] },
      { name: "lexical", items: [{ id: "b", score: 12 }, { id: "a", score: 10 }, { id: "d", score: 3 }] },
    ]);
    const ids = fused.map((f) => f.id);
    expect(ids.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(ids).toContain("c");
    expect(ids).toContain("d");
    expect(fused[0].ranks).toHaveProperty("dense");
    expect(fused[0].ranks).toHaveProperty("lexical");
  });

  it("空リストがあっても他方の順位がそのまま出る", () => {
    const fused = reciprocalRankFusion([
      { name: "dense", items: [] },
      { name: "lexical", items: [{ id: "x", score: 1 }, { id: "y", score: 0.5 }] },
    ]);
    expect(fused.map((f) => f.id)).toEqual(["x", "y"]);
  });

  it("重みで一方を強くできる", () => {
    const lists = [
      { name: "dense", items: [{ id: "a", score: 1 }, { id: "b", score: 0.9 }] },
      { name: "lexical", items: [{ id: "b", score: 1 }, { id: "a", score: 0.9 }] },
    ];
    expect(reciprocalRankFusion(lists, 60, { lexical: 3 })[0].id).toBe("b");
    expect(reciprocalRankFusion(lists, 60, { dense: 3 })[0].id).toBe("a");
  });

  it("同一リスト内の重複 id は最初の順位だけ数える", () => {
    const fused = reciprocalRankFusion([
      { name: "l", items: [{ id: "a", score: 1 }, { id: "a", score: 1 }, { id: "b", score: 1 }] },
    ]);
    expect(fused[0].id).toBe("a");
    expect(fused[0].score).toBeCloseTo(1 / 61, 6);
  });
});
