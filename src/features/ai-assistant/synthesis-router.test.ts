// synthesis-router の mapping を atomType 入力に対して検証する unit test。
// mapping は heuristic v1（proposal v4 由来）。「観察してから調整」前提で、
// 実装と mapping を分離可能にするためのテスト。

import { describe, it, expect } from "vitest";
import { routeSynthesisMode, pickTenpaiModes } from "./synthesis-router";

describe("routeSynthesisMode (heuristic v1)", () => {
  it("returns deductive when no atomType signal is available", () => {
    const r = routeSynthesisMode([]);
    expect(r.candidateModes).toEqual(["deductive"]);
    expect(r.recommendedMode).toBe("deductive");
  });

  it("ignores undefined entries and still falls back to deductive when all unknown", () => {
    const r = routeSynthesisMode([undefined, undefined]);
    expect(r.candidateModes).toEqual(["deductive"]);
  });

  it("recommends abductive when observational + causal are present", () => {
    const r = routeSynthesisMode(["observational", "causal"]);
    expect(r.recommendedMode).toBe("abductive");
    expect(r.candidateModes).toContain("abductive");
  });

  it("recommends abductive when observational + mechanistic are present", () => {
    const r = routeSynthesisMode(["observational", "mechanistic"]);
    expect(r.recommendedMode).toBe("abductive");
  });

  it("offers dialectic as a candidate when ≥2 causal atoms appear (LLM resolves direction)", () => {
    const r = routeSynthesisMode(["causal", "causal"]);
    expect(r.candidateModes).toContain("dialectic");
    // deductive should also remain as a permissive fallback
    expect(r.candidateModes).toContain("deductive");
  });

  it("offers analogical as a candidate when ≥2 mechanistic atoms appear (LLM resolves cross-domain)", () => {
    const r = routeSynthesisMode(["mechanistic", "mechanistic"]);
    expect(r.candidateModes).toContain("analogical");
  });

  it("recommends deductive for independent causal + methodological combination", () => {
    const r = routeSynthesisMode(["causal", "methodological"]);
    expect(r.recommendedMode).toBe("deductive");
    expect(r.candidateModes).toContain("deductive");
  });

  it("layers abductive + dialectic when observational coexists with 2 causal atoms", () => {
    const r = routeSynthesisMode(["observational", "causal", "causal"]);
    // abductive should win as the most specific signal
    expect(r.recommendedMode).toBe("abductive");
    expect(r.candidateModes).toContain("dialectic");
  });

  it("does not return dialectic for a single causal atom", () => {
    const r = routeSynthesisMode(["causal"]);
    expect(r.candidateModes).not.toContain("dialectic");
    expect(r.candidateModes).toContain("deductive");
  });

  it("does not return analogical for a single mechanistic atom", () => {
    const r = routeSynthesisMode(["mechanistic"]);
    expect(r.candidateModes).not.toContain("analogical");
  });

  it("returns deductive as the sole candidate for purely definitional / conditional inputs", () => {
    const r = routeSynthesisMode(["definitional", "conditional"]);
    expect(r.candidateModes).toEqual(["deductive"]);
  });

  it("preserves stable order: recommendedMode equals candidateModes[0]", () => {
    const cases: Parameters<typeof routeSynthesisMode>[0][] = [
      ["observational", "causal"],
      ["causal", "causal"],
      ["mechanistic", "mechanistic"],
      ["causal", "methodological"],
      [],
    ];
    for (const c of cases) {
      const r = routeSynthesisMode(c);
      expect(r.recommendedMode).toBe(r.candidateModes[0]);
    }
  });

  // ── Phase η: epistemicStatus signaling ──

  it("(Phase η) does not change the candidate set based on epistemic status — atomType remains load-bearing", () => {
    const withoutStatus = routeSynthesisMode(["causal", "causal"]);
    const withSpeculation = routeSynthesisMode(
      ["causal", "causal"],
      ["speculation", "speculation"],
    );
    expect(withSpeculation.candidateModes).toEqual(withoutStatus.candidateModes);
    expect(withSpeculation.recommendedMode).toBe(withoutStatus.recommendedMode);
  });

  it("(Phase η) sets hasSpeculativeInput=true when at least one input is speculation", () => {
    const r = routeSynthesisMode(
      ["observational", "causal"],
      ["speculation", "interpretation"],
    );
    expect(r.hasSpeculativeInput).toBe(true);
    expect(r.rationale).toContain("speculation");
  });

  it("(Phase η) leaves hasSpeculativeInput false when no input is speculation", () => {
    const r = routeSynthesisMode(
      ["observational", "causal"],
      ["observation", "interpretation"],
    );
    expect(r.hasSpeculativeInput).toBe(false);
  });

  it("(Phase η) records epistemic distribution in rationale when statuses are provided", () => {
    const r = routeSynthesisMode(
      ["observational", "mechanistic", "causal"],
      ["observation", "interpretation", "observation"],
    );
    expect(r.rationale).toContain("observation=2");
    expect(r.rationale).toContain("interpretation=1");
  });

  it("(Phase η) leaves rationale unchanged (no status section) when statuses are omitted", () => {
    const r = routeSynthesisMode(["observational", "causal"]);
    expect(r.rationale).not.toContain("epistemic distribution");
    expect(r.hasSpeculativeInput).toBeUndefined();
  });

  // ── Phase γ: rebuttalConditions signaling ──

  it("(Phase γ) adds dialectic candidate when ≥2 inputs carry rebuttalConditions even without causal trigger", () => {
    const r = routeSynthesisMode(
      ["mechanistic", "conditional"],
      undefined,
      [["above 80°C catalyst decays"], ["below pH 5 the reaction inverts"]],
    );
    expect(r.candidateModes).toContain("dialectic");
    expect(r.rationale).toContain("rebuttalConditions");
  });

  it("(Phase γ) does not add dialectic when only one input carries a rebuttal", () => {
    const r = routeSynthesisMode(
      ["mechanistic", "conditional"],
      undefined,
      [["above 80°C catalyst decays"], undefined],
    );
    expect(r.candidateModes).not.toContain("dialectic");
  });

  it("(Phase γ) deduplicates dialectic when both causal trigger and rebuttal trigger fire", () => {
    const r = routeSynthesisMode(
      ["causal", "causal"],
      undefined,
      [["limit A"], ["limit B"]],
    );
    const dialecticCount = r.candidateModes.filter((m) => m === "dialectic").length;
    expect(dialecticCount).toBe(1);
  });

  it("(Phase γ) ignores empty rebuttalConditions arrays", () => {
    const r = routeSynthesisMode(
      ["mechanistic", "conditional"],
      undefined,
      [[], []],
    );
    expect(r.candidateModes).not.toContain("dialectic");
  });
});

// ── 聴牌（tenpai）: pickTenpaiModes ───────────────────────────────────────
// router の判定境界を「= 1 件」「= 0 件」側にずらして「もうすぐ揃う」を返す。
describe("pickTenpaiModes (tenpai)", () => {
  it("returns empty when no atomType signal is available", () => {
    expect(pickTenpaiModes([])).toEqual([]);
    expect(pickTenpaiModes([undefined, undefined])).toEqual([]);
  });

  it("returns dialectic tenpai when exactly one causal atom is present", () => {
    const c = pickTenpaiModes(["causal", "definitional"]);
    const dialectic = c.find((x) => x.mode === "dialectic");
    expect(dialectic).toBeDefined();
    expect(dialectic?.missing.kind).toBe("one-more-causal");
    expect(dialectic?.basisIndices).toEqual([0]);
  });

  it("does NOT return dialectic tenpai when causal already has ≥2 (already satisfied)", () => {
    const c = pickTenpaiModes(["causal", "causal"]);
    expect(c.find((x) => x.mode === "dialectic")).toBeUndefined();
  });

  it("returns analogical tenpai when exactly one mechanistic atom is present", () => {
    const c = pickTenpaiModes(["mechanistic", "definitional"]);
    const analogical = c.find((x) => x.mode === "analogical");
    expect(analogical).toBeDefined();
    expect(analogical?.missing.kind).toBe("one-more-mechanism");
  });

  it("returns abductive tenpai when observational exists but no causal / mechanistic", () => {
    const c = pickTenpaiModes(["observational", "definitional"]);
    const abductive = c.find((x) => x.mode === "abductive");
    expect(abductive).toBeDefined();
    expect(abductive?.missing.kind).toBe("need-mechanism");
  });

  it("does NOT return abductive tenpai when causal exists (abductive already satisfied)", () => {
    const c = pickTenpaiModes(["observational", "causal"]);
    expect(c.find((x) => x.mode === "abductive")).toBeUndefined();
  });

  it("never returns deductive (deductive is fallback, not a tenpai signal)", () => {
    const cases: Parameters<typeof pickTenpaiModes>[0][] = [
      ["causal"],
      ["mechanistic"],
      ["observational"],
      ["methodological"],
      ["definitional"],
    ];
    for (const c of cases) {
      const result = pickTenpaiModes(c);
      expect(result.some((x) => x.mode === "deductive")).toBe(false);
    }
  });

  it("respects maxHints cap", () => {
    // causal=1 + mechanistic=1 + observational=0 → dialectic + analogical の 2 件
    // ただし observational=0 のため abductive は出ない
    const c = pickTenpaiModes(["causal", "mechanistic"], undefined, 1);
    expect(c.length).toBe(1);
  });

  it("(Phase δ) returns dialectic tenpai from a single 'contradicts' relationType", () => {
    const c = pickTenpaiModes(
      ["definitional", "definitional"],
      [["contradicts"], undefined],
    );
    const dialectic = c.find((x) => x.mode === "dialectic");
    expect(dialectic).toBeDefined();
    expect(dialectic?.basisIndices).toEqual([0]);
  });

  it("(Phase δ) does not duplicate dialectic when causal trigger and contradicts trigger both fire", () => {
    const c = pickTenpaiModes(
      ["causal", "definitional"],
      [undefined, ["contradicts"]],
    );
    const dialecticCount = c.filter((x) => x.mode === "dialectic").length;
    expect(dialecticCount).toBe(1);
  });
});
