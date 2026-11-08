import { describe, expect, it } from "vitest";
import { cumulativeLengths, edgeModelPath, pointAlong, seededRandom } from "./graph-firing";

describe("edgeModelPath", () => {
  it("制御点が無ければ直線", () => {
    expect(edgeModelPath({ x: 0, y: 0 }, { x: 10, y: 0 }, undefined)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it("制御点 1 つは 2 次ベジェ 1 本（始点と終点を通り、中ほどは制御点の側へ膨らむ）", () => {
    const path = edgeModelPath({ x: 0, y: 0 }, { x: 10, y: 0 }, [{ x: 5, y: 10 }], 4);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    expect(path[path.length - 1]).toEqual({ x: 10, y: 0 });
    // t=0.5 の点は (5, 5)
    expect(path[2]).toEqual({ x: 5, y: 5 });
  });

  it("制御点が複数なら、制御点の中点を区切りにしたベジェをつなぐ", () => {
    const path = edgeModelPath({ x: 0, y: 0 }, { x: 30, y: 0 }, [{ x: 10, y: 10 }, { x: 20, y: 10 }], 2);
    // 区切り: 始点 → c1 → (15,10) → c2 → 終点。1 本目の終わりが中点を通る
    expect(path).toContainEqual({ x: 15, y: 10 });
    expect(path[path.length - 1]).toEqual({ x: 30, y: 0 });
  });
});

describe("pointAlong", () => {
  it("長さの割合で位置を返す（両端と範囲外を丸める）", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const acc = cumulativeLengths(path);
    expect(acc).toEqual([0, 10, 20]);
    expect(pointAlong(path, acc, 0.25)).toEqual({ x: 5, y: 0 });
    expect(pointAlong(path, acc, 0.75)).toEqual({ x: 10, y: 5 });
    expect(pointAlong(path, acc, 2)).toEqual({ x: 10, y: 10 });
    expect(pointAlong(path, acc, -1)).toEqual({ x: 0, y: 0 });
  });
});

describe("seededRandom", () => {
  it("同じ種なら同じ並び、0〜1 の範囲", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    const xs = Array.from({ length: 5 }, () => a());
    expect(xs).toEqual(Array.from({ length: 5 }, () => b()));
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });
});
