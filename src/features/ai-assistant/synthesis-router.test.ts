// synthesis-router の mapping を atomType 入力に対して検証する unit test。
// mapping は heuristic v1（proposal v4 由来）。「観察してから調整」前提で、
// 実装と mapping を分離可能にするためのテスト。

import { describe, it, expect } from "vitest";
import { routeSynthesisMode } from "./synthesis-router";

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
    // Phase β: deductive is no longer added as a permissive companion when a
    // specific mode (dialectic / analogical / abductive) already fired.
    expect(r.candidateModes).not.toContain("deductive");
  });

  it("does NOT mix deductive into candidates when abductive already fired (Phase β)", () => {
    const r = routeSynthesisMode(["observational", "causal"]);
    expect(r.candidateModes).toContain("abductive");
    expect(r.candidateModes).not.toContain("deductive");
  });

  it("does NOT mix deductive into candidates when analogical already fired (Phase β)", () => {
    const r = routeSynthesisMode(["mechanistic", "mechanistic"]);
    expect(r.candidateModes).toContain("analogical");
    expect(r.candidateModes).not.toContain("deductive");
  });

  it("offers abductive when observational coexists with any other known atomType (Phase β widened condition)", () => {
    // observational + methodological no longer requires causal/mechanistic
    const r = routeSynthesisMode(["observational", "methodological"]);
    expect(r.candidateModes).toContain("abductive");
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
});
