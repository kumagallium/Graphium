import { describe, it, expect } from "vitest";
import type { ClaimSnapshot } from "../../server/services/wiki-synthesizer";
import {
  tokenize,
  jaccard,
  cosine,
  similarity,
  pickFarthestSeeds,
  buildClusterSlice,
  pickClusterCount,
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

describe("pickFarthestSeeds", () => {
  it("returns all atoms when k >= atoms.length", () => {
    const atoms = [
      mkAtom("a", "x", "x"),
      mkAtom("b", "y", "y"),
    ];
    expect(pickFarthestSeeds(atoms, 5)).toHaveLength(2);
  });

  it("first seed is the most-recently-modified", () => {
    const atoms = [
      mkAtom("old", "α", "α", null, "2025-01-01T00:00:00.000Z"),
      mkAtom("new", "β", "β", null, "2026-05-01T00:00:00.000Z"),
      mkAtom("mid", "γ", "γ", null, "2025-06-01T00:00:00.000Z"),
    ];
    const seeds = pickFarthestSeeds(atoms, 1);
    expect(seeds[0].snapshot.id).toBe("new");
  });

  it("spreads seeds across distinct clusters (jaccard fallback)", () => {
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
    const seeds = pickFarthestSeeds(atoms, 2);
    expect(seeds).toHaveLength(2);
    // 1st seed should be in PROV cluster (most recent)
    expect(provCluster.some((p) => p.snapshot.id === seeds[0].snapshot.id)).toBe(true);
    // 2nd seed should be in materials cluster (farthest from PROV)
    expect(materialsCluster.some((m) => m.snapshot.id === seeds[1].snapshot.id)).toBe(true);
  });

  it("returns empty for empty input or k=0", () => {
    expect(pickFarthestSeeds([], 3)).toHaveLength(0);
    expect(pickFarthestSeeds([mkAtom("a", "x", "x")], 0)).toHaveLength(0);
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

describe("pickClusterCount", () => {
  const opts = { effectiveCoverage: 30, maxK: 8 };

  it("returns 0 for empty corpus", () => {
    expect(pickClusterCount(0, opts)).toBe(0);
  });

  it("returns 1 for small corpus", () => {
    expect(pickClusterCount(1, opts)).toBe(1);
    expect(pickClusterCount(30, opts)).toBe(1);
  });

  it("scales with corpus size", () => {
    expect(pickClusterCount(31, opts)).toBe(2);
    expect(pickClusterCount(60, opts)).toBe(2);
    expect(pickClusterCount(90, opts)).toBe(3);
  });

  it("clamps to maxK", () => {
    expect(pickClusterCount(250, opts)).toBe(8);
    expect(pickClusterCount(10000, opts)).toBe(8);
  });

  it("uses different maxK independently", () => {
    expect(pickClusterCount(250, { effectiveCoverage: 30, maxK: 10 })).toBe(9);
    expect(pickClusterCount(500, { effectiveCoverage: 30, maxK: 10 })).toBe(10);
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
