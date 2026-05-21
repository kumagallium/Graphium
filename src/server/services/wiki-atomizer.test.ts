// wiki-atomizer の Tier 1 unit test
//
// LLM 呼び出しなしで以下を assert する:
//   1. detectRung1Tokens の pattern が corpus 既出の rung-1 token を catch する
//   2. parseAtomizerOutput が rung-1 atom 候補を post-emit で drop する
//   3. clean な rung-2 候補は通る (回帰防止)
//
// μ-1.3 までの bench で lift_score median = 0.714 までしか上がらなかった原因は、
// LLM atomizer が prompt で「rung-2 を出せ」と言われても "Al3V" "Klemens-Callaway"
// "PROV-DM" "ローレンツ数" 等を捨てられない点にあった。post-emit guard はこれの
// safety net。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectRung1Tokens, parseAtomizerOutput } from "./wiki-atomizer.ts";

describe("detectRung1Tokens — corpus-actual failing tokens", () => {
  it("catches digit-bearing chemical formulas (Bi2Te3, TiO2)", () => {
    expect(detectRung1Tokens("Bi2Te3 に Sb をドープすると ZT が向上する", "")).toContain("Bi2Te3");
    expect(detectRung1Tokens("TiO2 photocatalyst activity", "")).toContain("TiO2");
  });

  it("catches digit-less 2-element compounds (ZnSb, AlV, NaCl)", () => {
    expect(detectRung1Tokens("ZnSb が単相化する", "")).toContain("ZnSb");
    expect(detectRung1Tokens("AlV 系合金の熱伝導率", "")).toContain("AlV");
    expect(detectRung1Tokens("NaCl 結晶構造", "")).toContain("NaCl");
  });

  it("catches Al3V (digit-bearing mixed compound)", () => {
    const tokens = detectRung1Tokens("Al3V 系合金で熱伝導率が低下する", "");
    expect(tokens.some((t) => t.startsWith("Al"))).toBe(true);
  });

  it("catches hyphenated proper compounds (Klemens-Callaway, Klein-Nishina)", () => {
    expect(detectRung1Tokens("Klemens-Callaway モデルで格子熱伝導率を予測する", "")).toContain("Klemens-Callaway");
    expect(detectRung1Tokens("Klein-Nishina 散乱断面積", "")).toContain("Klein-Nishina");
  });

  it("catches 3+ char acronyms (SPS, ORR, PROV, ZT)", () => {
    expect(detectRung1Tokens("SPS 焼結条件で単相化する", "")).toContain("SPS");
    expect(detectRung1Tokens("ORR 活性が向上する", "")).toContain("ORR");
    expect(detectRung1Tokens("PROV-DM は合成手順を表現できる", "")).toContain("PROV");
  });

  it("ignores stoplist 2-char + common acronyms (AI / API / URL / JSON)", () => {
    expect(detectRung1Tokens("AI とは何か", "")).toEqual([]);
    expect(detectRung1Tokens("API は契約である", "")).toEqual([]);
    expect(detectRung1Tokens("URL は識別子", "")).toEqual([]);
    expect(detectRung1Tokens("JSON 形式", "")).toEqual([]);
  });

  it("does not flag plain rung-2 sentences", () => {
    expect(detectRung1Tokens("短時間の高温処理で揮発成分の分布が変わる", "")).toEqual([]);
    expect(detectRung1Tokens("二種類の元素でできた化合物に少量の別元素を加えると性質が変わる", "")).toEqual([]);
    expect(detectRung1Tokens("由来を辿れるかたちで作業を記述する仕組み", "")).toEqual([]);
  });

  it("looks at body head (first 120 chars) too", () => {
    const title = "助触媒の担持で還元活性点が増える";  // clean rung-2
    const body = "代表例として Pt/C 触媒の ORR 活性が挙げられる。"; // ORR in body head
    expect(detectRung1Tokens(title, body)).toContain("ORR");
  });
});

describe("parseAtomizerOutput — post-emit rung-1 guard", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeIdMap(snapshots: { id: string; title: string }[]): Map<string, string> {
    return new Map(snapshots.map((c) => [c.id, c.title]));
  }

  const baseSnapshots = [
    { id: "c1", title: "Claim 1" },
    { id: "c2", title: "Claim 2" },
  ];

  it("drops rung-1 atom title (Al3V) even with confidence ≥ 0.7", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "Al3V 系合金では Nb 置換で熱伝導率が低下する",
          body: "Al-V 系の合金に微量の Nb を置換することで熱伝導率が下がる。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
          atomType: "causal",
          epistemicStatus: "interpretation",
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("drops rung-1 atom (Klemens-Callaway)", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "Klemens-Callaway モデルで格子熱伝導率を定量化できる",
          body: "材料物性で広く用いられる関数形である。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toEqual([]);
  });

  it("drops rung-1 atom (PROV-DM)", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "PROV-DM は合成手順の分岐と合流を柔軟に表現できる",
          body: "履歴を残せる表現は工程設計の自由度を高める。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toEqual([]);
  });

  it("passes a clean rung-2 atom through", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "短時間の高温処理で揮発しやすい成分が抜けると、均一な仕上がりに繋がる",
          body: "高温で短い時間の処理では、まず揮発成分が動きやすくなり、結果として組成が揃いやすい状態に近づく。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
          atomType: "mechanistic",
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("短時間の高温処理");
  });

  it("filters rung-1 candidates but keeps clean ones in the same batch", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "Klemens-Callaway モデルで予測できる",
          body: "理論名に依存した記述。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
        },
        {
          title: "助触媒の担持で還元活性点が増える",
          body: "触媒の活性は分散度合いで変わる。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.9,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("助触媒");
  });
});
