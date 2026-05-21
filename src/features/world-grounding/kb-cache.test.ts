import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KbEntry, KbFile } from "./distilled-kb-retriever";

// StorageProvider を in-memory に差し替える（PR 2C で追加した migration / remove のテスト用）
const inMemoryStore: Record<string, unknown> = {};
vi.mock("../../lib/storage/registry", () => ({
  getActiveProvider: () => ({
    readAppData: async (key: string) => inMemoryStore[key] ?? null,
    writeAppData: async (key: string, value: unknown) => {
      if (value === null || value === undefined) delete inMemoryStore[key];
      else inMemoryStore[key] = value;
    },
  }),
}));

// vi.mock 後でないと kb-cache から本物の registry を引いてしまうので、import を後に置く
const {
  appendToKbCache,
  isValidForCaching,
  loadKbCache,
  mergeKb,
  removeFromKbCache,
  clearKbCacheForTest,
} = await import("./kb-cache");

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

describe("appendToKbCache / removeFromKbCache / loadKbCache (PR 2C)", () => {
  beforeEach(async () => {
    // 完全に in-memory store と migration フラグをリセット
    for (const k of Object.keys(inMemoryStore)) delete inMemoryStore[k];
    await clearKbCacheForTest();
  });

  it("appendToKbCache は単一キー 'grounding-kb-cache' に書く（PR 2C: domain 引数なし）", async () => {
    const ok = await appendToKbCache({
      id: "gen-a",
      verdict: "supported",
      claim: "model judged claim",
      rationale: "model r",
      keywords: ["k1"],
      generatedByModel: "claude-opus-4-7",
      version: 1,
    });
    expect(ok).toBe(true);
    expect(inMemoryStore["grounding-kb-cache"]).toBeTruthy();
    const file = inMemoryStore["grounding-kb-cache"] as KbFile;
    expect(file.entries.length).toBe(1);
    expect(file.entries[0].id).toBe("gen-a");
  });

  it("removeFromKbCache は指定 id を削除する", async () => {
    await appendToKbCache({
      id: "gen-a",
      verdict: "established",
      claim: "c1",
      rationale: "r1",
      keywords: ["k1"],
      generatedByModel: "claude-opus-4-7",
    });
    await appendToKbCache({
      id: "gen-b",
      verdict: "contested",
      claim: "c2",
      rationale: "r2",
      keywords: ["k2"],
      generatedByModel: "claude-opus-4-7",
    });
    const removed = await removeFromKbCache("gen-a");
    expect(removed).toBe(true);
    const after = await loadKbCache();
    expect(after?.entries.map((e) => e.id)).toEqual(["gen-b"]);
  });

  it("removeFromKbCache は存在しない id では false を返す", async () => {
    const removed = await removeFromKbCache("nonexistent");
    expect(removed).toBe(false);
  });

  it("legacy 'grounding-kb-cache-materials' が存在すれば新キーへマイグレートする", async () => {
    // 旧キー（PR 2B 時代）に entries を仕込む
    const legacy: KbFile = {
      version: 1,
      checkedBy: "distilled-kb@v1",
      seedSource: "model-cache@v1",
      entries: [
        {
          id: "legacy-1",
          verdict: "weak",
          claim: "legacy claim",
          rationale: "legacy r",
          keywords: ["legacy-kw"],
          generatedByModel: "claude-opus-4-7",
          version: 1,
        },
      ],
    };
    inMemoryStore["grounding-kb-cache-materials"] = legacy;

    // loadKbCache 経由で migration が走る
    const out = await loadKbCache();
    expect(out?.entries.map((e) => e.id)).toContain("legacy-1");
    // 旧キーは削除（null 化）される
    expect(inMemoryStore["grounding-kb-cache-materials"]).toBeUndefined();
    // 新キーには entry が乗っている
    const newFile = inMemoryStore["grounding-kb-cache"] as KbFile | undefined;
    expect(newFile?.entries.map((e) => e.id)).toContain("legacy-1");
  });

  it("マイグレーションは既存 cache と新規 legacy の両方を保持する（id 重複は old を捨てる）", async () => {
    // 既存の新キー cache
    inMemoryStore["grounding-kb-cache"] = {
      version: 1,
      checkedBy: "distilled-kb@v1",
      entries: [
        {
          id: "existing-1",
          verdict: "established",
          claim: "existing",
          rationale: "r",
          keywords: ["kw"],
          generatedByModel: "model-x",
        },
      ],
    } satisfies KbFile;
    // 旧キー
    inMemoryStore["grounding-kb-cache-materials"] = {
      version: 1,
      checkedBy: "distilled-kb@v1",
      entries: [
        {
          id: "existing-1", // 同 id → 既存（後勝ち）が残るので legacy は捨てる
          verdict: "weak",
          claim: "legacy collision",
          rationale: "r",
          keywords: ["kw"],
          generatedByModel: "model-old",
        },
        {
          id: "legacy-only",
          verdict: "contested",
          claim: "only in legacy",
          rationale: "r",
          keywords: ["kw"],
          generatedByModel: "model-old",
        },
      ],
    } satisfies KbFile;

    const out = await loadKbCache();
    const ids = out?.entries.map((e) => e.id) ?? [];
    expect(ids).toContain("existing-1");
    expect(ids).toContain("legacy-only");
    // 衝突した legacy 側の verdict は反映されない（既存を温存）
    const existing = out?.entries.find((e) => e.id === "existing-1");
    expect(existing?.verdict).toBe("established");
  });
});
