import { describe, expect, it } from "vitest";
import { VOICE_HINT_MAX_CHARS, buildVoiceHint, rankLatinTerms } from "./hint-terms";

const note = (title: string, headings: string[] = []) => ({
  title,
  headings: headings.map((text, i) => ({ blockId: `b${i}`, text, level: 2 as const })),
});

describe("rankLatinTerms", () => {
  it("化学式・略語だけを拾い、出てくるノートの数の多い順に並べる", () => {
    const terms = rankLatinTerms([
      note("LiCoO2 の焼きなまし", ["XRD の結果"]),
      note("LiCoO2 の熱伝導率"),
      note("Bi2Te3 と LiCoO2", ["XRD"]),
      note("GitHub の README を読む"),
    ]);
    expect(terms.slice(0, 2)).toEqual(["LiCoO2", "XRD"]);
    expect(terms).toContain("Bi2Te3");
    // 普通の英単語（大文字 1 つ・数字なし）や 2 文字の語は拾わない
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("Te");
  });

  it("同じノートに何度出ても 1 と数える", () => {
    const terms = rankLatinTerms([note("SPS SPS SPS", ["SPS"]), note("XRD"), note("XRD")]);
    expect(terms).toEqual(["XRD", "SPS"]);
  });
});

describe("buildVoiceHint", () => {
  it("英字の語を空白でつなぎ、設定の用語を末尾に置く", () => {
    expect(buildVoiceHint(["LiCoO2", "XRD"], "焼きなまし, 粒径")).toBe("LiCoO2 XRD 焼きなまし, 粒径");
    expect(buildVoiceHint(["LiCoO2"], "")).toBe("LiCoO2");
    expect(buildVoiceHint([], "  ")).toBe("");
  });

  it("上限を超えない（設定の用語は削らない）", () => {
    const many = Array.from({ length: 100 }, (_, i) => `Al${i}Ge${i}`);
    const user = "焼きなまし, 粒径";
    const hint = buildVoiceHint(many, user);
    expect(hint.length).toBeLessThanOrEqual(VOICE_HINT_MAX_CHARS);
    expect(hint.endsWith(user)).toBe(true);
    expect(hint.startsWith("Al0Ge0 ")).toBe(true);
  });
});
