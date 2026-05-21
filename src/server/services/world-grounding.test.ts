import { describe, expect, it } from "vitest";

import {
  buildWorldGroundingSystemPrompt,
  buildWorldGroundingUserMessage,
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
