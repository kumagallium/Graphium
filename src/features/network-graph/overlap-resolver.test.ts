import { describe, it, expect } from "vitest";
import { resolveOverlaps, countOverlaps, type OverlapItem } from "./overlap-resolver";

const apply = (items: OverlapItem[], pos: Map<string, { x: number; y: number }>) =>
  items.map((it) => ({ ...it, ...pos.get(it.id)! }));

describe("resolveOverlaps（重なりを押し離す）", () => {
  it("同じ点に積まれた知見が半径ぶん離れる", () => {
    const items: OverlapItem[] = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, x: 100, y: 100, r: 7 }));
    const after = apply(items, resolveOverlaps(items, { gap: 4 }));
    expect(countOverlaps(after, 4)).toBe(0);
    // 遠くへ飛ばない（山の周りにほぐれる）
    for (const n of after) expect(Math.hypot(n.x - 100, n.y - 100)).toBeLessThan(120);
  });

  it("fixed のノードは動かず、相手だけが押される", () => {
    const items: OverlapItem[] = [
      { id: "topic", x: 0, y: 0, r: 20, fixed: true },
      { id: "claim", x: 5, y: 0, r: 7 },
    ];
    const pos = resolveOverlaps(items, { gap: 6 });
    expect(pos.get("topic")).toEqual({ x: 0, y: 0 });
    const c = pos.get("claim")!;
    expect(Math.hypot(c.x, c.y)).toBeGreaterThanOrEqual(20 + 7 + 6 - 1e-6);
  });

  it("重なっていないノードは動かない（決定的）", () => {
    const items: OverlapItem[] = [
      { id: "a", x: 0, y: 0, r: 10 },
      { id: "b", x: 100, y: 0, r: 10 },
    ];
    const pos = resolveOverlaps(items);
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")).toEqual({ x: 100, y: 0 });
    expect(resolveOverlaps(items)).toEqual(pos);
  });

  it("1,000 件でも短時間で終わる", () => {
    const items: OverlapItem[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `n${i}`,
      x: (i % 10) * 3,
      y: Math.floor(i / 10) * 3,
      r: 7,
    }));
    const t = performance.now();
    const after = apply(items, resolveOverlaps(items));
    expect(performance.now() - t).toBeLessThan(2000);
    expect(countOverlaps(after)).toBeLessThan(items.length * 0.02);
  });
});
