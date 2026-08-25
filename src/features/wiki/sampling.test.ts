import { describe, it, expect } from "vitest";
import type { ClaimSnapshot } from "../../server/services/wiki-types";
import {
  tokenize,
  jaccard,
  cosine,
  similarity,
  buildClusterSlice,
  planCoverageSeeds,
  rankCandidatesByRelevance,
  type AtomCandidate,
} from "./sampling";

function mkAtom(
  id: string,
  title: string,
  body: string,
  embedding: number[] | null = null,
  modifiedTime: string = "2026-01-01T00:00:00.000Z",
): AtomCandidate {
  const snapshot: ClaimSnapshot = {
    id,
    title,
    bodyPreview: body,
    level: undefined,
    relatedClaims: [],
    sourceSummaryPreviews: [],
    atomType: undefined,
  };
  return {
    snapshot,
    similarityText: `${title}\n${body}`,
    embedding,
    modifiedTime,
  };
}

describe("tokenize", () => {
  it("splits on non-letter/number and lowercases", () => {
    const tokens = tokenize("PROV-DM and Materials Science!");
    expect(tokens.has("prov")).toBe(true);
    expect(tokens.has("dm")).toBe(true);
    expect(tokens.has("materials")).toBe(true);
    expect(tokens.has("and")).toBe(true);
    expect(tokens.has("!")).toBe(false);
  });

  it("keeps Japanese characters", () => {
    const tokens = tokenize("プロブナンスと材料科学");
    expect(tokens.size).toBeGreaterThan(0);
  });

  it("drops single-character tokens", () => {
    const tokens = tokenize("a bb ccc");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("bb")).toBe(true);
    expect(tokens.has("ccc")).toBe(true);
  });
});

describe("jaccard", () => {
  it("returns 1 for identical sets", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["x", "y", "z"]);
    expect(jaccard(a, b)).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["c", "d"]);
    expect(jaccard(a, b)).toBe(0);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("computes partial overlap", () => {
    const a = new Set(["x", "y", "z"]);
    const b = new Set(["y", "z", "w"]);
    expect(jaccard(a, b)).toBeCloseTo(2 / 4, 5);
  });
});

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it("clamps negatives to 0", () => {
    expect(cosine([1, 0], [-1, 0])).toBe(0);
  });

  it("returns 0 for mismatched dimensions", () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
});

describe("similarity", () => {
  it("uses cosine when both atoms have embeddings", () => {
    const a = mkAtom("a", "Foo", "", [1, 0, 0]);
    const b = mkAtom("b", "Bar", "", [1, 0, 0]);
    expect(similarity(a, b)).toBeCloseTo(1, 5);
  });

  it("falls back to jaccard when embeddings missing", () => {
    const a = mkAtom("a", "materials science", "lattice");
    const b = mkAtom("b", "materials science", "lattice");
    expect(similarity(a, b)).toBeCloseTo(1, 5);
  });

  it("returns low similarity for unrelated text without embeddings", () => {
    const a = mkAtom("a", "PROV-DM provenance", "tracking");
    const b = mkAtom("b", "音楽理論", "和声学");
    expect(similarity(a, b)).toBeLessThan(0.1);
  });
});

describe("planCoverageSeeds", () => {
  it("returns empty plan for empty input or sliceLimit <= 0", () => {
    expect(planCoverageSeeds([], 50).seeds).toHaveLength(0);
    expect(planCoverageSeeds([], 50).totalCount).toBe(0);
    expect(planCoverageSeeds([mkAtom("a", "x", "x")], 0).seeds).toHaveLength(0);
  });

  it("reaches 100% coverage: last cumulativeCovered equals totalCount", () => {
    const atoms = Array.from({ length: 23 }, (_, i) =>
      mkAtom(`a${i}`, `topic-${i % 5} title ${i}`, `body ${i}`),
    );
    const plan = planCoverageSeeds(atoms, 7);
    expect(plan.totalCount).toBe(23);
    expect(plan.cumulativeCovered[plan.cumulativeCovered.length - 1]).toBe(23);
    expect(plan.cumulativeCovered).toHaveLength(plan.seeds.length);
  });

  it("uses a single seed when the slice can hold the whole population", () => {
    const atoms = Array.from({ length: 10 }, (_, i) =>
      mkAtom(`a${i}`, `title ${i}`, `body ${i}`),
    );
    const plan = planCoverageSeeds(atoms, 50);
    expect(plan.seeds).toHaveLength(1);
    expect(plan.cumulativeCovered).toEqual([10]);
  });

  it("cumulativeCovered is strictly increasing (every seed adds new coverage)", () => {
    const atoms = Array.from({ length: 40 }, (_, i) =>
      mkAtom(`a${i}`, `cluster-${i % 8} word ${i}`, `text ${i}`),
    );
    const plan = planCoverageSeeds(atoms, 5);
    for (let i = 1; i < plan.cumulativeCovered.length; i++) {
      expect(plan.cumulativeCovered[i]).toBeGreaterThan(plan.cumulativeCovered[i - 1]);
    }
  });

  it("first seed is the most-recently-modified", () => {
    const atoms = [
      mkAtom("old", "α", "α", null, "2025-01-01T00:00:00.000Z"),
      mkAtom("new", "β", "β", null, "2026-05-01T00:00:00.000Z"),
      mkAtom("mid", "γ", "γ", null, "2025-06-01T00:00:00.000Z"),
    ];
    const plan = planCoverageSeeds(atoms, 1);
    expect(plan.seeds[0].snapshot.id).toBe("new");
  });

  it("second seed jumps to the uncovered far cluster (jaccard fallback)", () => {
    const provCluster = [
      mkAtom("p1", "PROV provenance tracking", "lineage activity"),
      mkAtom("p2", "PROV provenance lineage", "tracking activity entity"),
      mkAtom("p3", "provenance lineage activity", "PROV tracking"),
    ];
    const materialsCluster = [
      mkAtom("m1", "lattice diffusion materials", "crystal structure"),
      mkAtom("m2", "crystal structure lattice", "materials diffusion"),
      mkAtom("m3", "diffusion materials crystal", "lattice structure"),
    ];
    const atoms = [...provCluster, ...materialsCluster];
    // recent: pick p1 first
    atoms[0].modifiedTime = "2026-05-01T00:00:00.000Z";
    const plan = planCoverageSeeds(atoms, 3);
    // 1st seed: PROV cluster (most recent) → its slice covers the PROV side
    expect(provCluster.some((p) => p.snapshot.id === plan.seeds[0].snapshot.id)).toBe(true);
    // 2nd seed: uncovered materials cluster (farthest from seed 1)
    expect(materialsCluster.some((m) => m.snapshot.id === plan.seeds[1].snapshot.id)).toBe(true);
    // 2 slices of 3 cover all 6
    expect(plan.cumulativeCovered[plan.cumulativeCovered.length - 1]).toBe(6);
  });

  it("is deterministic for the same input", () => {
    const atoms = Array.from({ length: 17 }, (_, i) =>
      mkAtom(`a${i}`, `theme-${i % 4} title ${i}`, `body ${i}`),
    );
    const p1 = planCoverageSeeds(atoms, 4);
    const p2 = planCoverageSeeds(atoms, 4);
    expect(p1.seeds.map((s) => s.snapshot.id)).toEqual(p2.seeds.map((s) => s.snapshot.id));
    expect(p1.cumulativeCovered).toEqual(p2.cumulativeCovered);
  });

  it("terminates even in the degenerate all-identical case (sliceLimit 1)", () => {
    const atoms = Array.from({ length: 6 }, (_, i) =>
      mkAtom(`a${i}`, "same title", "same body"),
    );
    const plan = planCoverageSeeds(atoms, 1);
    // 各スライスは seed 自身しか含まないので、全件カバーには 6 seed 必要
    expect(plan.seeds).toHaveLength(6);
    expect(plan.cumulativeCovered[5]).toBe(6);
  });
});

describe("buildClusterSlice", () => {
  it("includes the seed first", () => {
    const a = mkAtom("a", "alpha", "alpha");
    const b = mkAtom("b", "beta", "beta");
    const slice = buildClusterSlice([a, b], a, 10);
    expect(slice[0]).toBe(a);
  });

  it("respects the limit", () => {
    const atoms = Array.from({ length: 100 }, (_, i) =>
      mkAtom(`a${i}`, `title ${i}`, `body ${i}`),
    );
    const slice = buildClusterSlice(atoms, atoms[0], 50);
    expect(slice).toHaveLength(50);
  });

  it("orders by similarity to seed (jaccard)", () => {
    const seed = mkAtom("seed", "PROV provenance tracking lineage", "");
    const near = mkAtom("near", "PROV provenance lineage", "");
    const far = mkAtom("far", "音楽理論 和声", "");
    const atoms = [far, near, seed];
    const slice = buildClusterSlice(atoms, seed, 3);
    expect(slice[0]).toBe(seed);
    expect(slice[1]).toBe(near);
    expect(slice[2]).toBe(far);
  });
});

describe("rankCandidatesByRelevance", () => {
  it("returns empty for empty candidates", () => {
    const result = rankCandidatesByRelevance(
      { embedding: null, similarityText: "x" },
      [],
      10,
    );
    expect(result).toEqual([]);
  });

  it("returns empty when limit <= 0", () => {
    const result = rankCandidatesByRelevance(
      { embedding: null, similarityText: "x" },
      [{ embedding: null, similarityText: "x" }],
      0,
    );
    expect(result).toEqual([]);
  });

  it("sorts by similarity descending and caps to limit", () => {
    const query = { embedding: null, similarityText: "PROV-DM traceability" };
    const candidates = [
      { id: "far", embedding: null, similarityText: "Material synthesis temperature" },
      { id: "near", embedding: null, similarityText: "PROV traceability metadata" },
      { id: "mid", embedding: null, similarityText: "PROV unrelated topic" },
    ];
    const result = rankCandidatesByRelevance(query, candidates, 2);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("near"); // most relevant
  });

  it("uses embedding when both sides have it", () => {
    const query = { embedding: [1, 0, 0], similarityText: "ignored" };
    const candidates = [
      { id: "a", embedding: [0, 1, 0], similarityText: "ignored" },
      { id: "b", embedding: [1, 0, 0], similarityText: "ignored" },
    ];
    const result = rankCandidatesByRelevance(query, candidates, 2);
    expect(result[0].id).toBe("b");
    expect(result[1].id).toBe("a");
  });

  it("returns all candidates sorted when count <= limit", () => {
    const query = { embedding: null, similarityText: "alpha beta" };
    const candidates = [
      { id: "x", embedding: null, similarityText: "gamma delta" },
      { id: "y", embedding: null, similarityText: "alpha gamma" },
    ];
    const result = rankCandidatesByRelevance(query, candidates, 10);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("y"); // shares "alpha"
  });
});
