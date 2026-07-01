import { describe, expect, it } from "vitest";

import {
  buildWorldGroundingSystemPrompt,
  buildWorldGroundingUserMessage,
  buildWebGroundedSystemPrompt,
  buildWebGroundedUserMessage,
  parseWorldGroundingOutput,
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

  it("parametric では URL/DOI を出さず ref テキストのみと指示する（捏造対策）", () => {
    const sys = buildWorldGroundingSystemPrompt("en");
    expect(sys).toMatch(/Do NOT output any URL or DOI/i);
    expect(sys).toMatch(/TEXT ONLY/);
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
    // 既定 none モードでは ref は残るが url は捨てられる
    expect(out?.sources?.[0].ref).toMatch(/Sintering/);
    expect(out?.sources?.[0].url).toBeUndefined();
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

  // 既定（none）モード: parametric 判定では URL を一切出さない（記憶由来 URL の捏造対策）。
  it("既定(none)モードでは Wikipedia / DOI / arXiv も含め全 URL を捨てる（ref は残す）", () => {
    const raw = JSON.stringify({
      verdict: "established",
      rationale: "x",
      sources: [
        { ref: "Wikipedia: Sintering", url: "https://en.wikipedia.org/wiki/Sintering" },
        { ref: "DOI", url: "https://doi.org/10.1126/science.1156391" },
        { ref: "arXiv", url: "https://arxiv.org/abs/2403.12345" },
        { ref: "Nature paper", url: "https://www.nature.com/articles/nmat2090" },
      ],
    });
    const out = parseWorldGroundingOutput(raw);
    // ref は全部残るが url は全て undefined（記憶由来 URL は出さない）
    expect(out?.sources?.length).toBe(4);
    expect(out?.sources?.every((s) => s.url === undefined)).toBe(true);
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

  it("引数なし呼び出しは none モード（URL を出さない）", () => {
    const raw = JSON.stringify({
      verdict: "supported",
      rationale: "x",
      sources: [{ ref: "Nature", url: "https://www.nature.com/articles/nmat2090" }],
    });
    // 既定 none モードでは記憶由来 URL は捨てられる（ref は残る）
    const out = parseWorldGroundingOutput(raw);
    expect(out?.sources?.[0].ref).toBe("Nature");
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
