import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KbEntry, KbFile } from "./distilled-kb-retriever";
import { isValidForCaching, mergeKb } from "./kb-cache";

// StorageProvider 経由の I/O を持つテスト（appendToKbCache / loadKbCache）は
// registry を mock しないと走らないが、純粋ロジック部分はモックなしで網羅できる。

describe("isValidForCaching — 沈殿の鉄則", () => {
  const baseEntry: KbEntry = {
    id: "gen-1",
    verdict: "established",
    claim: "焼結温度を上げると粒成長が促進される",
    rationale: "Coble sintering",
    keywords: ["焼結", "粒成長", "sintering"],
    generatedByModel: "claude-opus-4-7",
    version: 1,
  };

  it("4 値 verdict + generatedByModel + 非空 claim/keywords を満たせば沈殿可", () => {
    expect(isValidForCaching(baseEntry)).toBe(true);
  });

  it("鉄則 1: verdict が null 相当の値は沈殿しない（not_found 非沈殿）", () => {
    const bad = { ...baseEntry, verdict: null as any };
    expect(isValidForCaching(bad)).toBe(false);
  });

  it("鉄則 1: verdict が 4 値以外の文字列も沈殿しない", () => {
    const bad = { ...baseEntry, verdict: "unknown" as any };
    expect(isValidForCaching(bad)).toBe(false);
  });

  it("鉄則 2: generatedByModel が無い entry は沈殿しない（seed と区別）", () => {
    const { generatedByModel: _omit, ...bad } = baseEntry;
    expect(isValidForCaching(bad as KbEntry)).toBe(false);
  });

  it("鉄則 2: manual-curated@v1 印の entry は沈殿しない（seed 専用印）", () => {
    const bad = { ...baseEntry, generatedByModel: "manual-curated@v1" };
    expect(isValidForCaching(bad)).toBe(false);
  });

  it("鉄則 3: claim が空白だけなら沈殿しない", () => {
    const bad = { ...baseEntry, claim: "   " };
    expect(isValidForCaching(bad)).toBe(false);
  });

  it("鉄則 3: keywords が空配列なら沈殿しない", () => {
    const bad = { ...baseEntry, keywords: [] };
    expect(isValidForCaching(bad)).toBe(false);
  });
});

describe("mergeKb — seed + cache の合成", () => {
  const seed: KbFile = {
    version: 1,
    domain: "materials",
    checkedBy: "distilled-kb@v1",
    seedSource: "manual-curated@v1",
    entries: [
      {
        id: "mat-001",
        verdict: "established",
        claim: "seed claim",
        rationale: "r1",
        keywords: ["k1"],
      },
      {
        id: "mat-002",
        verdict: "supported",
        claim: "seed claim 2",
        rationale: "r2",
        keywords: ["k2"],
      },
    ],
  };
  const cache: KbFile = {
    version: 1,
    domain: "materials",
    checkedBy: "distilled-kb@v1",
    seedSource: "model-cache@v1",
    entries: [
      {
        id: "gen-1",
        verdict: "contested",
        claim: "model-judged claim",
        rationale: "model r",
        keywords: ["kx"],
        generatedByModel: "claude-opus-4-7",
        version: 1,
      },
    ],
  };

  it("seed のみのときは seed をそのまま返す", () => {
    const out = mergeKb(seed, null);
    expect(out?.entries.length).toBe(2);
  });

  it("cache のみのときは cache をそのまま返す（seed なしでも動く）", () => {
    const out = mergeKb(null, cache);
    expect(out?.entries.length).toBe(1);
    expect(out?.entries[0].id).toBe("gen-1");
  });

  it("seed + cache をマージし、entries が連結される", () => {
    const out = mergeKb(seed, cache);
    expect(out?.entries.length).toBe(3);
    expect(out?.entries.map((e) => e.id)).toContain("mat-001");
    expect(out?.entries.map((e) => e.id)).toContain("gen-1");
  });

  it("entry id 重複は cache を優先（cache 側が更新版を持つ可能性）", () => {
    const cacheWithDup: KbFile = {
      ...cache,
      entries: [
        {
          id: "mat-001",  // seed と同じ ID
          verdict: "contested",  // seed の established を上書き
          claim: "updated by model",
          rationale: "newer rationale",
          keywords: ["k1-updated"],
          generatedByModel: "claude-opus-4-7",
          version: 1,
        },
      ],
    };
    const out = mergeKb(seed, cacheWithDup);
    expect(out?.entries.length).toBe(2);
    const mat001 = out?.entries.find((e) => e.id === "mat-001");
    expect(mat001?.verdict).toBe("contested");
    expect(mat001?.claim).toBe("updated by model");
  });

  it("seed と cache が両方 null なら null", () => {
    expect(mergeKb(null, null)).toBeNull();
  });
});
