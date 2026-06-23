import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildWorldGroundingSystemPrompt,
  buildWorldGroundingUserMessage,
  buildWebGroundedSystemPrompt,
  buildWebGroundedUserMessage,
  parseWorldGroundingOutput,
  verifyResultSourceUrls,
  verifySourceUrl,
} from "./world-grounding.js";

describe("buildWorldGroundingSystemPrompt", () => {
  it("verdict が 4 値 + null の選択肢になる contract を明記している", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    expect(sys).toMatch(/established/);
    expect(sys).toMatch(/supported/);
    expect(sys).toMatch(/weak/);
    expect(sys).toMatch(/contested/);
    expect(sys).toMatch(/null/);
  });

  it("ja ロケールでは日本語で書くよう指示する", () => {
    const sys = buildWorldGroundingSystemPrompt("ja");
    expect(sys).toMatch(/日本語/);
  });

  it("「KB の見方」「ユーザーへの評価ではない」と明示している", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    expect(sys).toMatch(/KB's view/);
    expect(sys).toMatch(/NOT a judgment/);
  });
});

describe("parseWorldGroundingOutput", () => {
  it("素の JSON を解釈する", () => {
    const raw = JSON.stringify({
      verdict: "established",
      rationale: "Coble sintering law",
      normalizedClaim: "Sintering temperature drives grain growth in late stage.",
      keywords: ["焼結", "sintering", "粒成長", "grain growth"],
      sources: [{ ref: "Wikipedia: Sintering", url: "https://en.wikipedia.org/wiki/Sintering" }],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.verdict).toBe("established");
    expect(out?.normalizedClaim).toMatch(/Sintering/);
    expect(out?.keywords).toHaveLength(4);
    expect(out?.sources?.[0].url).toMatch(/wikipedia/);
  });

  it("```json ブロックでラップされていても剥がして解釈する", () => {
    const raw = "```json\n" + JSON.stringify({
      verdict: "supported",
      rationale: "broadly used",
      normalizedClaim: "x",
      keywords: ["a", "b"],
    }) + "\n```";
    const out = parseWorldGroundingOutput(raw);
    expect(out?.verdict).toBe("supported");
  });

  it("verdict が 4 値以外の文字列は null に丸める", () => {
    const raw = JSON.stringify({
      verdict: "highly_established",  // 不正値
      rationale: "x",
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.verdict).toBeNull();
  });

  it("verdict が null（判定不能）も受け付ける（鉄則の出口）", () => {
    const raw = JSON.stringify({
      verdict: null,
      rationale: "out of domain",
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.verdict).toBeNull();
    expect(out?.rationale).toBe("out of domain");
  });

  it("JSON パース失敗は null を返す（呼び出し元で degrade）", () => {
    const out = parseWorldGroundingOutput("not a json {");
    expect(out).toBeNull();
  });

  it("空配列の keywords / sources は undefined に丸める", () => {
    const raw = JSON.stringify({
      verdict: "weak",
      rationale: "x",
      keywords: [],
      sources: [],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.keywords).toBeUndefined();
    expect(out?.sources).toBeUndefined();
  });

  it("sources の url が無くても ref だけで採用される", () => {
    const raw = JSON.stringify({
      verdict: "established",
      rationale: "x",
      sources: [{ ref: "Ashcroft & Mermin" }],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.[0].ref).toBe("Ashcroft & Mermin");
    expect(out?.sources?.[0].url).toBeUndefined();
  });

  // URL whitelist sanitize（LLM 幻覚 URL 対策、ユーザー報告で発覚）
  it("Wikipedia (en/ja) と DOI と arXiv の URL は通す", () => {
    const raw = JSON.stringify({
      verdict: "established",
      rationale: "x",
      sources: [
        { ref: "Wikipedia: Sintering", url: "https://en.wikipedia.org/wiki/Sintering" },
        { ref: "焼結 (ja)", url: "https://ja.wikipedia.org/wiki/焼結" },
        { ref: "DOI", url: "https://doi.org/10.1126/science.1156391" },
        { ref: "arXiv", url: "https://arxiv.org/abs/2403.12345" },
      ],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.map((s) => s.url)).toEqual([
      "https://en.wikipedia.org/wiki/Sintering",
      "https://ja.wikipedia.org/wiki/焼結",
      "https://doi.org/10.1126/science.1156391",
      "https://arxiv.org/abs/2403.12345",
    ]);
  });

  it("出版社サイト / 論文 PDF / lab page など whitelist 外の URL は捨てる（ref は残す）", () => {
    const raw = JSON.stringify({
      verdict: "supported",
      rationale: "x",
      sources: [
        { ref: "Nature paper", url: "https://www.nature.com/articles/nmat2090" },
        { ref: "Some PDF", url: "https://example.edu/papers/foo.pdf" },
        { ref: "Lab page", url: "https://prof-smith.example.org/research" },
      ],
    });
    const out = parseWorldGroundingOutput(raw);
    // ref は全部残す
    expect(out?.sources?.length).toBe(3);
    // url は全部 undefined（whitelist 外なので捨てた）
    expect(out?.sources?.every((s) => s.url === undefined)).toBe(true);
  });

  it("file:// や javascript: など非 http(s) URL は捨てる", () => {
    const raw = JSON.stringify({
      verdict: "weak",
      rationale: "x",
      sources: [
        { ref: "local file", url: "file:///etc/passwd" },
        { ref: "js injection", url: "javascript:alert(1)" },
      ],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.every((s) => s.url === undefined)).toBe(true);
  });

  it("URL parse 失敗（不正フォーマット）も捨てる", () => {
    const raw = JSON.stringify({
      verdict: "established",
      rationale: "x",
      sources: [{ ref: "broken", url: "not a url" }],
    });
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.[0].url).toBeUndefined();
  });
});

// 幻覚 URL 対策・第 2 段: 実在検証（ユーザー報告: gpt-oss が whitelist 内ドメインの
// 実在しない Wikipedia 記事 URL を吐く → 404 リンクが KB に沈殿していた）
describe("verifySourceUrl: URL の実在をネットワークで検証する", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(impl: (url: string, init?: any) => Promise<{ ok: boolean }>) {
    vi.stubGlobal("fetch", vi.fn((u: any, init?: any) => impl(String(u), init)));
  }

  it("Wikipedia: REST summary が 200 なら実在 = true", async () => {
    stubFetch(async (url) => {
      expect(url).toContain("/api/rest_v1/page/summary/");
      return { ok: true };
    });
    expect(await verifySourceUrl("https://en.wikipedia.org/wiki/Entropy")).toBe(true);
  });

  it("Wikipedia: REST summary が 404 なら実在せず = false", async () => {
    stubFetch(async () => ({ ok: false }));
    expect(
      await verifySourceUrl("https://ja.wikipedia.org/wiki/存在しない記事ABC"),
    ).toBe(false);
  });

  it("Wikipedia: /wiki/ でないパス（幻覚の検索 URL 等）は false", async () => {
    stubFetch(async () => ({ ok: true }));
    expect(
      await verifySourceUrl("https://en.wikipedia.org/w/index.php?search=foo"),
    ).toBe(false);
  });

  it("arXiv / DOI: HEAD が ok なら true、404 なら false", async () => {
    stubFetch(async (url) => ({ ok: url.includes("arxiv") }));
    expect(await verifySourceUrl("https://arxiv.org/abs/2403.12345")).toBe(true);
    expect(await verifySourceUrl("https://doi.org/10.0/nonexistent")).toBe(false);
  });

  it("ネットワーク例外 / タイムアウトは false に倒す（不確実なら捨てる）", async () => {
    stubFetch(async () => {
      throw new Error("network down");
    });
    expect(await verifySourceUrl("https://en.wikipedia.org/wiki/Entropy")).toBe(false);
  });

  it("不正な URL 文字列は false", async () => {
    expect(await verifySourceUrl("not a url")).toBe(false);
  });
});

describe("verifyResultSourceUrls: 実在しない url を剥がして ref は残す", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("実在する url は残し、しない url は剥がす（ref は両方残る）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: any) => ({ ok: String(u).includes("Real") })),
    );
    const out = await verifyResultSourceUrls({
      verdict: "established",
      rationale: "x",
      sources: [
        { ref: "Real article", url: "https://en.wikipedia.org/wiki/Real" },
        { ref: "Fake article", url: "https://en.wikipedia.org/wiki/Fake" },
        { ref: "No url at all" },
      ],
    });
    expect(out.sources).toEqual([
      { ref: "Real article", url: "https://en.wikipedia.org/wiki/Real" },
      { ref: "Fake article" },
      { ref: "No url at all" },
    ]);
  });

  it("sources が無ければそのまま返す（fetch を呼ばない）", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = { verdict: "weak" as const, rationale: "x" };
    expect(await verifyResultSourceUrls(result)).toBe(result);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ── web-grounding（Phase 5）: 検索証拠に基づく判定 ────────────────────────────
describe("buildWebGroundedSystemPrompt", () => {
  it("検索証拠に基づき記憶に頼らないよう指示する", () => {
    const sys = buildWebGroundedSystemPrompt("en");
    expect(sys).toMatch(/SEARCH EVIDENCE/);
    expect(sys).toMatch(/do NOT rely on your own memory/i);
  });

  it("URL は証拠に出てきたものだけ（記憶から生成禁止）と明記する", () => {
    const sys = buildWebGroundedSystemPrompt("en");
    expect(sys).toMatch(/ONLY URLs that appear verbatim in the EVIDENCE/);
    expect(sys).toMatch(/NEVER invent/i);
  });

  it("null は「新規性の証明ではない」と表現する（構造的限界）", () => {
    const sys = buildWebGroundedSystemPrompt("en");
    expect(sys).toMatch(/not proof of novelty/i);
  });

  it("verdict は 4 値 + null を維持する（パーサー共通）", () => {
    const sys = buildWebGroundedSystemPrompt("en");
    for (const v of ["established", "supported", "weak", "contested", "null"]) {
      expect(sys).toMatch(new RegExp(v));
    }
  });

  it("ja ロケールでは日本語で書くよう指示する", () => {
    expect(buildWebGroundedSystemPrompt("ja")).toMatch(/日本語/);
  });
});

describe("buildWebGroundedUserMessage", () => {
  it("claim と検索証拠の両方を含む", () => {
    const msg = buildWebGroundedUserMessage({
      claimText: "test claim",
      evidenceText: "Result https://a.com/x",
    });
    expect(msg).toMatch(/test claim/);
    expect(msg).toMatch(/SEARCH EVIDENCE/);
    expect(msg).toMatch(/https:\/\/a\.com\/x/);
  });
});

describe("parseWorldGroundingOutput: evidence モードの URL ガードレール", () => {
  it("証拠に出てきた URL は通す（任意ドメインでも）", () => {
    const allowedUrls = new Set([
      "https://www.nature.com/articles/nmat2090",
      "https://blog.example.dev/post",
    ]);
    const raw = JSON.stringify({
      verdict: "supported",
      rationale: "x",
      sources: [
        { ref: "Nature", url: "https://www.nature.com/articles/nmat2090" },
        { ref: "Blog", url: "https://blog.example.dev/post" },
      ],
    });
    const out = parseWorldGroundingOutput(raw, { mode: "evidence", allowedUrls });
    expect(out?.sources?.map((s) => s.url)).toEqual([
      "https://www.nature.com/articles/nmat2090",
      "https://blog.example.dev/post",
    ]);
  });

  it("証拠に無い URL は捨てる（ref は残す）= 記憶由来 URL の混入を防ぐ", () => {
    const allowedUrls = new Set(["https://www.nature.com/articles/nmat2090"]);
    const raw = JSON.stringify({
      verdict: "supported",
      rationale: "x",
      sources: [
        { ref: "real", url: "https://www.nature.com/articles/nmat2090" },
        { ref: "hallucinated", url: "https://www.science.org/doi/10.1126/made-up" },
      ],
    });
    const out = parseWorldGroundingOutput(raw, { mode: "evidence", allowedUrls });
    expect(out?.sources?.length).toBe(2);
    expect(out?.sources?.[0].url).toBe("https://www.nature.com/articles/nmat2090");
    expect(out?.sources?.[1].url).toBeUndefined();
  });

  it("末尾スラッシュ / hash 違いも正規化一致で通す", () => {
    const allowedUrls = new Set(["https://example.com/doc"]);
    const raw = JSON.stringify({
      verdict: "weak",
      rationale: "x",
      sources: [{ ref: "doc", url: "https://example.com/doc/#section" }],
    });
    const out = parseWorldGroundingOutput(raw, { mode: "evidence", allowedUrls });
    expect(out?.sources?.[0].url).toBe("https://example.com/doc/#section");
  });

  it("引数なし呼び出しは従来どおり whitelist モード（後方互換）", () => {
    const raw = JSON.stringify({
      verdict: "supported",
      rationale: "x",
      sources: [{ ref: "Nature", url: "https://www.nature.com/articles/nmat2090" }],
    });
    // whitelist モードでは nature.com は捨てられる
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.[0].url).toBeUndefined();
  });
});

describe("buildWorldGroundingUserMessage (PR 2C: domain 引数廃止)", () => {
  it("claim を含み strict JSON を要求する", () => {
    const msg = buildWorldGroundingUserMessage({
      claimText: "test claim",
    });
    expect(msg).toMatch(/test claim/);
    expect(msg).toMatch(/strict JSON/i);
  });

  it("user message に domain 文字列を含まない（PR 2C で削除）", () => {
    const msg = buildWorldGroundingUserMessage({
      claimText: "test claim",
    });
    expect(msg).not.toMatch(/Domain:/);
  });
});

describe("system prompt: PR 2C で domain hard-coding / tags 生成 / out-of-domain ルールを撤廃", () => {
  it("prompt から 'materials domain' 系のハードコードと out-of-domain ルールが消えている", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    // PR 2B では '"materials" domain' や 'the given domain' のように
    // 単一 domain に hard-bind する文言があった。PR 2C で全削除する。
    expect(sys).not.toMatch(/"materials"\s+domain/i);
    expect(sys).not.toMatch(/the\s+given\s+domain/i);
    expect(sys).not.toMatch(/out[\s-]?of[\s-]?domain/i);
  });

  it("tags 生成も prompt から削除されている（PR 2C で分類問題を持ち込まない）", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    expect(sys).not.toMatch(/"tags"/);
  });

  it("null verdict の意味が「知識ベースに信頼できる根拠なし」に変わっている", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    expect(sys).toMatch(/does not contain reliable evidence/);
  });
});
