// bench/adversarial.ts の判定と baseline 比較の unit test（LLM call なし）
//
// CI の adversarial ジョブは「baseline と違うときだけ PR にコメントする」。判定や比較が
// 静かに壊れると、コメントが二度と出なくなるか、毎 PR 同じコメントに戻る。その規則をここで固定する。

import { describe, it, expect } from "vitest";
import {
  evaluateChecks,
  verdictOf,
  parseProbe,
  parseProbes,
  toBaseline,
  diffAgainstBaseline,
  formatComment,
  type AdversarialCheck,
  type AdversarialResult,
} from "./adversarial.ts";
import type { BenchAtom, BenchClaim } from "./types.ts";

function makeClaim(overrides: Partial<BenchClaim> = {}): BenchClaim {
  return {
    sourceNoteId: "note-a",
    title: "Claim title",
    body: "claim body",
    claimRoles: ["finding"],
    epistemicStatus: "interpretation",
    rebuttalConditions: [],
    ...overrides,
  };
}

function makeAtom(overrides: Partial<BenchAtom> = {}): BenchAtom {
  return {
    title: "Atom title",
    body: "atom body",
    derivedFromClaims: ["0"],
    derivedFromNoteIds: ["note-a"],
    epistemicStatus: "interpretation",
    liftLevel: "rung-2",
    ...overrides,
  };
}

function check(name: string, status: AdversarialCheck["status"]): AdversarialCheck {
  return { name, status, reason: "" };
}

function makeResult(name: string, checks: AdversarialCheck[]): AdversarialResult {
  return {
    name,
    kind: "safety",
    verdict: verdictOf(checks),
    checks,
    durationMs: 0,
    counts: { claims: 1, atoms: 1 },
  };
}

describe("evaluateChecks", () => {
  it("does not evaluate banned-string checks in dry-run, even when the text is in the output", () => {
    // dry-run はノート本文を写すので、禁止語が出力に残っていても FAIL にはしない
    const out = {
      claims: [makeClaim({ body: "090-1234-5678" })],
      atoms: [makeAtom({ title: "090-1234-5678", body: "090-1234-5678" })],
    };
    const checks = evaluateChecks(
      {
        pipelineCompletes: true,
        atomTitleMustNotContain: ["090-1234-5678"],
        atomBodyMustNotContain: ["090-1234-5678"],
        claimContentMustNotContain: ["090-1234-5678"],
      },
      out,
      undefined,
      1,
    );
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ["pipelineCompletes", "pass"],
      ["atomTitleMustNotContain", "skip"],
      ["atomBodyMustNotContain", "skip"],
      ["claimContentMustNotContain", "skip"],
    ]);
  });

  it("still evaluates the count and epistemic-status checks", () => {
    const out = {
      claims: [makeClaim(), makeClaim()],
      atoms: [makeAtom({ epistemicStatus: "established" })],
    };
    const checks = evaluateChecks(
      { maxClaims: 1, minAtoms: 1, atomEpistemicStatusMustNotBe: "established" },
      out,
      undefined,
      1,
    );
    expect(checks.map((c) => [c.name, c.status])).toEqual([
      ["maxClaims", "fail"],
      ["minAtoms", "pass"],
      ["atomEpistemicStatusMustNotBe", "fail"],
    ]);
  });

  it("reports a crash as a failed pipelineCompletes and evaluates nothing else", () => {
    const checks = evaluateChecks({ pipelineCompletes: true, maxClaims: 1 }, null, "boom", 1);
    expect(checks).toEqual([
      { name: "pipelineCompletes", status: "fail", reason: "pipeline error: boom" },
    ]);
  });
});

describe("verdictOf", () => {
  it("fails when any evaluated check fails, even if others were not evaluated", () => {
    expect(verdictOf([check("a", "skip"), check("b", "fail")])).toBe("fail");
  });

  it("does not pass a probe whose checks were only partly evaluated", () => {
    expect(verdictOf([check("pipelineCompletes", "pass"), check("b", "skip")])).toBe("skip");
  });

  it("passes only when every check was evaluated and passed", () => {
    expect(verdictOf([check("a", "pass"), check("b", "pass")])).toBe("pass");
  });

  it("treats a probe without checks as not evaluated", () => {
    expect(verdictOf([])).toBe("skip");
  });
});

describe("parseProbe", () => {
  const base = { name: "p", category: "adversarial", kind: "safety", inputs: [], rationale: "" };

  it("rejects keys that no check implements", () => {
    // Synthesis 撤去後も残っていたキー。黙って無視すると、効いていないチェックが効いて見える
    const raw = JSON.stringify({ ...base, expected: { pipelineCompletes: true, maxSyntheses: 0 } });
    expect(() => parseProbe("p.probe.json", raw)).toThrow(/unknown expected key\(s\): maxSyntheses/);
  });

  it("rejects a probe without checks", () => {
    const raw = JSON.stringify({ ...base, expected: {} });
    expect(() => parseProbe("p.probe.json", raw)).toThrow(/no checks/);
  });

  it.each([
    ["pipelineCompletes", false], // 「完了しないこと」の検査は無く、黙って何もしなくなる
    ["maxClaims", "1"],
    ["atomBodyMustNotContain", []],
    ["atomEpistemicStatusMustNotBe", ""],
  ])("rejects a value the check does not support (%s: %j)", (key, value) => {
    const raw = JSON.stringify({ ...base, expected: { [key]: value } });
    expect(() => parseProbe("p.probe.json", raw)).toThrow(
      new RegExp(`unsupported value for expected key\\(s\\): ${key}`),
    );
  });

  it("accepts a probe that uses only known keys and supported values", () => {
    const raw = JSON.stringify({
      ...base,
      expected: { pipelineCompletes: true, maxClaims: 0, atomBodyMustNotContain: ["x"] },
    });
    expect(parseProbe("p.probe.json", raw).name).toBe("p");
  });
});

describe("parseProbes", () => {
  const file = (fileName: string, name: string) => ({
    fileName,
    raw: JSON.stringify({
      name,
      category: "adversarial",
      kind: "robustness",
      inputs: [],
      rationale: "",
      expected: { pipelineCompletes: true },
    }),
  });

  it("rejects two probes with the same name, which would overwrite each other in the baseline", () => {
    expect(() => parseProbes([file("a.probe.json", "same"), file("b.probe.json", "same")])).toThrow(
      /duplicate adversarial probe name: same/,
    );
  });

  it("reads probes with distinct names in order", () => {
    const probes = parseProbes([file("a.probe.json", "a"), file("b.probe.json", "b")]);
    expect(probes.map((p) => p.name)).toEqual(["a", "b"]);
  });
});

describe("diffAgainstBaseline", () => {
  const results = [
    makeResult("stable", [check("pipelineCompletes", "pass")]),
    makeResult("changing", [check("pipelineCompletes", "pass"), check("atomBodyMustNotContain", "skip")]),
  ];

  it("reports nothing when the results match the baseline", () => {
    expect(diffAgainstBaseline(toBaseline({ results }), toBaseline({ results }))).toEqual([]);
  });

  it("ignores the order of checks", () => {
    const reordered = [results[0], makeResult("changing", [...results[1].checks].reverse())];
    expect(diffAgainstBaseline(toBaseline({ results }), toBaseline({ results: reordered }))).toEqual([]);
  });

  it("reports a check whose status changed", () => {
    const now = [
      results[0],
      makeResult("changing", [check("pipelineCompletes", "pass"), check("atomBodyMustNotContain", "fail")]),
    ];
    const changes = diffAgainstBaseline(toBaseline({ results }), toBaseline({ results: now }));
    expect(changes).toHaveLength(1);
    expect(changes[0].probe).toBe("changing");
    expect(changes[0].before?.verdict).toBe("skip");
    expect(changes[0].after?.verdict).toBe("fail");
    expect(changes[0].checkChanges).toEqual([
      { name: "atomBodyMustNotContain", before: "skip", after: "fail" },
    ]);
  });

  it("reports added and removed probes", () => {
    const now = [results[0], makeResult("added", [check("pipelineCompletes", "pass")])];
    const changes = diffAgainstBaseline(toBaseline({ results }), toBaseline({ results: now }));
    expect(changes.map((c) => [c.probe, c.before?.verdict, c.after?.verdict])).toEqual([
      ["changing", "skip", undefined],
      ["added", undefined, "pass"],
    ]);
  });

  it("treats a missing baseline as every probe being new", () => {
    const changes = diffAgainstBaseline(undefined, toBaseline({ results }));
    expect(changes.map((c) => c.probe)).toEqual(["stable", "changing"]);
  });
});

describe("formatComment", () => {
  it("lists each changed probe with the checks that changed and how to re-record the baseline", () => {
    const now = [
      makeResult("changing", [check("pipelineCompletes", "pass"), check("atomBodyMustNotContain", "fail")]),
    ];
    const before = [
      makeResult("changing", [check("pipelineCompletes", "pass"), check("atomBodyMustNotContain", "skip")]),
    ];
    const changes = diffAgainstBaseline(toBaseline({ results: before }), toBaseline({ results: now }));
    const md = formatComment(changes, true, "full report");
    expect(md).toContain("| `changing` | SKIP | FAIL | `atomBodyMustNotContain` skip → fail |");
    expect(md).toContain("BENCH_ADVERSARIAL_UPDATE_BASELINE=true pnpm bench:adversarial");
    expect(md).toContain("full report");
  });
});
