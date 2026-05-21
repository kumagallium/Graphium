import { describe, expect, it } from "vitest";

import type { WikiMeta } from "../../lib/document-types";
import { attachValidity, checkValidity } from "./index";
import {
  checkValidityFromKB,
  clearKbCacheForTest,
  type KbFile,
} from "./distilled-kb-retriever";

const NOW = "2026-05-21T10:00:00.000Z";

function baseMeta(overrides: Partial<WikiMeta> = {}): WikiMeta {
  return {
    kind: "claim",
    derivedFromNotes: ["note-x"],
    derivedFromChats: [],
    generatedAt: NOW,
    generatedBy: { model: "test-model", version: "1.0.0" },
    epistemicStatus: "interpretation",
    hypothesisStatus: "speculative",
    level: "principle",
    status: "candidate",
    ...overrides,
  };
}

describe("world-grounding is a separate lane from epistemicStatus / hypothesisStatus", () => {
  it("attachValidity は epistemicStatus を書き換えない", () => {
    const meta = baseMeta({ epistemicStatus: "interpretation" });
    const next = attachValidity(meta, {
      verdict: "established",
      checkedBy: "distilled-kb@v1",
      checkedAt: NOW,
    });
    expect(next.epistemicStatus).toBe("interpretation");
  });

  it("attachValidity は hypothesisStatus を書き換えない", () => {
    const meta = baseMeta({ hypothesisStatus: "speculative" });
    const next = attachValidity(meta, {
      verdict: "supported",
      checkedBy: "distilled-kb@v1",
      checkedAt: NOW,
    });
    expect(next.hypothesisStatus).toBe("speculative");
  });

  it("verdict 'contested' でも hypothesisStatus は refuted に変わらない", () => {
    const meta = baseMeta({ hypothesisStatus: "speculative" });
    const next = attachValidity(meta, {
      verdict: "contested",
      checkedBy: "distilled-kb@v1",
      checkedAt: NOW,
    });
    expect(next.hypothesisStatus).toBe("speculative");
    expect(next.grounding?.validity?.verdict).toBe("contested");
  });

  it("attachValidity は claimRole / level / status / confidence など他フィールドを温存する", () => {
    const meta = baseMeta({
      claimRole: ["finding"],
      level: "principle",
      status: "verified",
      confidence: 0.82,
    });
    const next = attachValidity(meta, {
      verdict: "weak",
      checkedBy: "distilled-kb@v1",
      checkedAt: NOW,
    });
    expect(next.claimRole).toEqual(["finding"]);
    expect(next.level).toBe("principle");
    expect(next.status).toBe("verified");
    expect(next.confidence).toBe(0.82);
  });

  it("既存 grounding.suggests があっても attachValidity は suggests を温存する", () => {
    const meta = baseMeta({
      grounding: {
        suggests: {
          field: "epistemicStatus",
          to: "established",
          reason: "KB が established と一致",
        },
      },
    });
    const next = attachValidity(meta, {
      verdict: "established",
      checkedBy: "distilled-kb@v1",
      checkedAt: NOW,
    });
    expect(next.grounding?.suggests?.field).toBe("epistemicStatus");
    expect(next.grounding?.suggests?.to).toBe("established");
    expect(next.grounding?.validity?.verdict).toBe("established");
    // epistemicStatus 本体は触らない
    expect(next.epistemicStatus).toBe("interpretation");
  });

  it("validity を undefined で attach すると grounding.validity が消える", () => {
    const meta = baseMeta({
      grounding: {
        validity: {
          verdict: "weak",
          checkedBy: "distilled-kb@v1",
          checkedAt: NOW,
        },
      },
    });
    const next = attachValidity(meta, undefined);
    expect(next.grounding?.validity).toBeUndefined();
  });

  it("validity だけ消しても suggests は残る", () => {
    const meta = baseMeta({
      grounding: {
        validity: {
          verdict: "weak",
          checkedBy: "distilled-kb@v1",
          checkedAt: NOW,
        },
        suggests: {
          field: "hypothesisStatus",
          to: "confirmed",
          reason: "test",
        },
      },
    });
    const next = attachValidity(meta, undefined);
    expect(next.grounding?.validity).toBeUndefined();
    expect(next.grounding?.suggests?.to).toBe("confirmed");
  });
});

describe("distilled-kb retriever", () => {
  const sampleKb: KbFile = {
    version: 1,
    checkedBy: "distilled-kb@v1",
    entries: [
      {
        id: "mat-test-est",
        verdict: "established",
        claim: "焼結温度を上げると粒成長が促進される",
        rationale: "Coble sintering",
        keywords: ["焼結", "粒成長", "sintering", "grain growth"],
      },
      {
        id: "mat-test-con",
        verdict: "contested",
        claim: "ナノ粒子の凝集は常に体積拡散より速い",
        rationale: "実験で支持されない",
        keywords: ["ナノ粒子", "凝集", "nanoparticle", "agglomeration"],
      },
      {
        id: "mat-test-weak",
        verdict: "weak",
        claim: "SPS のパルス電流が粒成長を抑える",
        rationale: "実機構は議論中",
        keywords: ["SPS", "パルス電流", "粒成長", "spark plasma"],
      },
    ],
  };

  it("KB マッチなし（語彙ヒット 0）は null を返す（degrade）", async () => {
    const result = await checkValidityFromKB(
      "今日の昼食はそばだった。研究とは無関係。",
      { kb: sampleKb },
    );
    expect(result).toBeNull();
  });

  it("keywords 1 件のみ一致は null（最低 2 件で degrade）", async () => {
    const result = await checkValidityFromKB(
      "焼結の話だけ。", // "焼結" は 1 件のみ
      { kb: sampleKb },
    );
    expect(result).toBeNull();
  });

  it("keywords 2 件一致で verdict を返す", async () => {
    const result = await checkValidityFromKB(
      "焼結温度を高めると粒成長が起きる",
      { kb: sampleKb },
    );
    expect(result).not.toBeNull();
    expect(result?.verdict).toBe("established");
    expect(result?.matchedKeywords.length).toBeGreaterThanOrEqual(2);
  });

  it("contested エントリの語彙一致で contested を返す", async () => {
    const result = await checkValidityFromKB(
      "ナノ粒子の凝集について検討する",
      { kb: sampleKb },
    );
    expect(result?.verdict).toBe("contested");
  });

  it("英語の keywords も部分一致で拾う", async () => {
    const result = await checkValidityFromKB(
      "sintering temperature drives grain growth in materials",
      { kb: sampleKb },
    );
    expect(result?.verdict).toBe("established");
  });

  it("NFKC 正規化で全角・半角を吸収する", async () => {
    const result = await checkValidityFromKB(
      "ナノ粒子の凝集（全角カッコ）と nanoparticle agglomeration",
      { kb: sampleKb },
    );
    expect(result?.verdict).toBe("contested");
  });

  it("複数 entry がマッチする場合は matchedKeywords が多い方を返す", async () => {
    const result = await checkValidityFromKB(
      "SPS による粒成長 (spark plasma) でパルス電流を使う sintering",
      { kb: sampleKb },
    );
    // "SPS" / "パルス電流" / "粒成長" / "spark plasma" → weak エントリが優位
    // "焼結"=未含, "sintering" / "粒成長" → established 2 件
    // weak entry: SPS/パルス電流/粒成長/spark plasma = 4 件
    expect(result?.verdict).toBe("weak");
  });

  it("空 KB は null（fail-open）", async () => {
    const emptyKb: KbFile = { ...sampleKb, entries: [] };
    const result = await checkValidityFromKB("焼結温度と粒成長", { kb: emptyKb });
    expect(result).toBeNull();
  });

  it("空文字 claimText は null", async () => {
    const result = await checkValidityFromKB("", { kb: sampleKb });
    expect(result).toBeNull();
  });
});

describe("checkValidity facade", () => {
  const sampleKb: KbFile = {
    version: 1,
    checkedBy: "distilled-kb@v1",
    entries: [
      {
        id: "mat-x",
        verdict: "established",
        claim: "test",
        rationale: "established rationale",
        keywords: ["焼結", "粒成長", "sintering"],
        sources: [{ kind: "distilled", ref: "Wikipedia: Sintering", url: "https://example.test/sintering" }],
      },
    ],
  };

  it("matchedKeywords が validity に保存される（UI で「何が hit したか」を見せる用）", async () => {
    const meta = baseMeta();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(sampleKb), { status: 200 })) as typeof fetch;
    clearKbCacheForTest();
    try {
      const validity = await checkValidity(meta, "焼結温度を上げると粒成長が促進される", {
        baseUrl: "/test-baseurl/",
      });
      expect(validity?.verdict).toBe("established");
      expect(validity?.matchedKeywords).toEqual(expect.arrayContaining(["焼結", "粒成長"]));
      expect(validity?.sources?.[0]).toMatchObject({
        kind: "distilled",
        url: "https://example.test/sintering",
      });
    } finally {
      globalThis.fetch = originalFetch;
      clearKbCacheForTest();
    }
  });

  it("KB miss + LLM 未登録（or 失敗）は verdict 未付与 + checkedBy='no-engine' で degrade（PR 2B 新挙動）", async () => {
    // PR 2B: KB miss 時は LLM fallback を試みる。テスト環境では groundingModel 未設定 +
    // localStorage 空のため、checkValidityViaModel が null を返し、checkedBy: "no-engine" に degrade する。
    const meta = baseMeta();
    const originalFetch = globalThis.fetch;
    // KB JSON は seed のみ返し、LLM endpoint への fetch は呼ばれてはいけない
    // （getGroundingModelName() が空文字 → checkValidityViaModel が早期 null）
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("grounding-kb/")) {
        return new Response(JSON.stringify(sampleKb), { status: 200 });
      }
      // LLM endpoint が呼ばれてしまったら 503（テスト中の意図しないネットワーク）
      return new Response("not reached", { status: 503 });
    }) as typeof fetch;
    clearKbCacheForTest();
    try {
      const validity = await checkValidity(meta, "全く別ドメインの本文", {
        baseUrl: "/test-baseurl/",
      });
      expect(validity?.verdict).toBeUndefined();
      // PR 2B: degrade のとき checkedBy は "no-engine"（KB ヒット時の "distilled-kb@v1" と区別）
      expect(validity?.checkedBy).toBe("no-engine");
      expect(validity?.checkedAt).toBeTruthy();
      expect(validity?.matchedKeywords).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
      clearKbCacheForTest();
    }
  });
});

describe("loadKb cache + fetch (fail-open)", () => {
  it("ネットワーク不在の base URL は null を返す（cache キャッシュも null）", async () => {
    clearKbCacheForTest();
    // テスト環境では fetch が存在しないか相対 URL に解決できない想定
    // global.fetch をモックして 404 を返す
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("not found", { status: 404 })) as typeof fetch;
    try {
      const result = await checkValidityFromKB("焼結温度と粒成長", {
        baseUrl: "/test-missing/",
      });
      expect(result).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      clearKbCacheForTest();
    }
  });

  it("loadSeedKb は固定ファイル名 seed.v1.json を fetch する（PR 2C: domain 引数なし）", async () => {
    clearKbCacheForTest();
    const fetchedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      fetchedUrls.push(url);
      return new Response(
        JSON.stringify({
          version: 1,
          checkedBy: "distilled-kb@v1",
          entries: [],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const { loadSeedKb } = await import("./distilled-kb-retriever");
      await loadSeedKb("/world-grounding-test-base/");
      expect(fetchedUrls).toEqual([
        "/world-grounding-test-base/grounding-kb/seed.v1.json",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      clearKbCacheForTest();
    }
  });
});
