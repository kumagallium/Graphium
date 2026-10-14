import { describe, it, expect } from "vitest";
import { pullBySimilarity, type SimilarityItem } from "./similarity-pull";

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("pullBySimilarity（埋め込みの近い知見を島の中で寄せる）", () => {
  it("似たペアは近づき、似ていないペアは近づかない", () => {
    const items: SimilarityItem[] = [
      { id: "a", x: 0, y: 0, group: "g", vector: [1, 0, 0] },
      { id: "b", x: 100, y: 0, group: "g", vector: [0.98, 0.2, 0] },
      { id: "c", x: 0, y: 100, group: "g", vector: [0, 0, 1] },
    ];
    const { positions, pairs } = pullBySimilarity(items, { threshold: 0.8 });
    expect(pairs).toBe(1);
    expect(dist(positions.get("a")!, positions.get("b")!)).toBeLessThan(100);
    expect(dist(positions.get("a")!, positions.get("c")!)).toBeGreaterThanOrEqual(99);
  });

  it("島をまたぐペアは結ばない", () => {
    const items: SimilarityItem[] = [
      { id: "a", x: 0, y: 0, group: "g1", vector: [1, 0] },
      { id: "b", x: 100, y: 0, group: "g2", vector: [1, 0] },
    ];
    const { positions, pairs } = pullBySimilarity(items);
    expect(pairs).toBe(0);
    expect(positions.get("a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("b")).toEqual({ x: 100, y: 0 });
  });

  it("元の位置へのばねがあるので、寄っても島の外へは出ない", () => {
    const items: SimilarityItem[] = [
      { id: "a", x: 0, y: 0, group: "g", vector: [1, 0] },
      { id: "b", x: 300, y: 0, group: "g", vector: [1, 0] },
    ];
    const { positions } = pullBySimilarity(items);
    const a = positions.get("a")!;
    const b = positions.get("b")!;
    expect(a.x).toBeGreaterThan(0);
    expect(b.x).toBeLessThan(300);
    expect(a.x).toBeLessThan(150);
    expect(b.x).toBeGreaterThan(150);
  });

  it("埋め込みの無い知見は動かない・結果は決定的", () => {
    const items: SimilarityItem[] = [
      { id: "a", x: 0, y: 0, group: "g", vector: [1, 0] },
      { id: "b", x: 50, y: 0, group: "g", vector: [1, 0.05] },
      { id: "n", x: 20, y: 20, group: "g" },
    ];
    const r1 = pullBySimilarity(items);
    expect(r1.positions.get("n")).toEqual({ x: 20, y: 20 });
    expect(r1.participants).toBe(2);
    expect(pullBySimilarity(items)).toEqual(r1);
  });

  it("相手は maxNeighbors 本までに絞る", () => {
    const items: SimilarityItem[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, x: i * 30, y: 0, group: "g", vector: [1, i * 0.01] }));
    const { pairs } = pullBySimilarity(items, { maxNeighbors: 2 });
    expect(pairs).toBeLessThanOrEqual(10 * 2);
  });
});
