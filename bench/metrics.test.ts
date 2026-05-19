// Phase μ-1: metrics の Tier 1 unit test
//
// LLM call なしで「既知の入力 → 期待 metric 値」を assert する。
// Tier 1 として毎 commit / CI で走らせる前提（spec §5）。

import { describe, it, expect } from "vitest";
import {
  liftScore,
  modeDistributionEntropy,
  epistemicPreservation,
  adversarialPassRate,
  noveltyScore,
  observationAtomRatio,
} from "./metrics.ts";
import type {
  BenchAtom,
  BenchClaim,
  BenchSynthesis,
  GroundTruth,
  ProbeResult,
} from "./types.ts";

function makeAtom(overrides: Partial<BenchAtom> = {}): BenchAtom {
  return {
    title: "Generic atom",
    body: "no jargon body",
    atomType: "causal",
    derivedFromClaims: ["0"],
    derivedFromNoteIds: ["note-a"],
    epistemicStatus: "interpretation",
    liftLevel: "rung-2",
    ...overrides,
  };
}

function makeSynthesis(mode: BenchSynthesis["mode"], i = 0): BenchSynthesis {
  return {
    title: `S${i}`,
    body: `body of synthesis ${i}`,
    mode,
    sourceAtomIndices: [0, 1],
    hypothesisStatus: "tested",
    externalSources: [],
  };
}

function makeClaim(noteId: string, status: string): BenchClaim {
  return {
    sourceNoteId: noteId,
    title: `Claim for ${noteId}`,
    body: "body",
    claimRoles: ["finding"],
    epistemicStatus: status,
    rebuttalConditions: [],
  };
}

describe("liftScore", () => {
  it("rung-2 (no jargon) Atom returns 1.0", () => {
    const atoms = [makeAtom({ title: "短時間の高温処理", body: "揮発しやすい成分が抜ける" })];
    expect(liftScore(atoms)).toBe(1);
  });

  it("rung-1 (jargon remains) Atom returns 0", () => {
    const atoms = [makeAtom({ title: "SPS 焼結条件", body: "ZnSb の単相化" })];
    expect(liftScore(atoms)).toBe(0);
  });

  it("mixed Atoms returns intermediate", () => {
    // 2 つめの atom は "ORR" (3-char acronym) で pattern-based 判定が catch する。
    // 単独元素記号 ("Pt") は pattern では catch できない既知の限界（下のテスト参照）。
    const atoms = [
      makeAtom({ title: "短時間の高温処理", body: "揮発しやすい" }),
      makeAtom({ title: "ORR 活性", body: "還元反応の起こりやすさ" }),
    ];
    expect(liftScore(atoms)).toBe(0.5);
  });

  it("(known limitation) single element symbols like 'Pt' are NOT caught by pattern-based heuristic", () => {
    // Phase μ-1.1 で corpus-agnostic patterns に置き換えた結果、単独 1-2 文字の
    // 元素記号 (Pt, Zn 単独, Si 単独 など) は pattern が catch できない。これは
    // pattern が「3+ char 大文字略語 / 化学式 (digit を含む) / 装置 ID (digit を含む)」
    // に絞っているため。元素記号の jargon 性は live LLM judge が判定するのが正規ルート。
    // この test は heuristic の false-negative を明示的に文書化するためにある。
    const atoms = [makeAtom({ title: "Pt 担持", body: "還元活性" })];
    expect(liftScore(atoms)).toBe(1);
  });

  it("empty atoms returns 1 (vacuous)", () => {
    expect(liftScore([])).toBe(1);
  });
});

describe("modeDistributionEntropy", () => {
  it("all-deductive returns 0 (maximally biased)", () => {
    const s = Array.from({ length: 8 }, (_, i) => makeSynthesis("deductive", i));
    expect(modeDistributionEntropy(s)).toBe(0);
  });

  it("4 modes equal returns 1 (max entropy)", () => {
    const s = [
      makeSynthesis("deductive", 0),
      makeSynthesis("abductive", 1),
      makeSynthesis("analogical", 2),
      makeSynthesis("dialectic", 3),
    ];
    expect(modeDistributionEntropy(s)).toBe(1);
  });

  it("empty syntheses returns 0", () => {
    expect(modeDistributionEntropy([])).toBe(0);
  });

  it("partial mix returns intermediate", () => {
    // 2 deductive + 2 abductive → entropy log2(2)/log2(4) = 0.5
    const s = [
      makeSynthesis("deductive", 0),
      makeSynthesis("deductive", 1),
      makeSynthesis("abductive", 2),
      makeSynthesis("abductive", 3),
    ];
    expect(modeDistributionEntropy(s)).toBe(0.5);
  });
});

describe("epistemicPreservation", () => {
  it("all claims match GT expected returns 1", () => {
    const claims = [
      makeClaim("note-a", "speculation"),
      makeClaim("note-b", "observation"),
    ];
    const gtMap = new Map<string, GroundTruth>([
      ["note-a", { noteId: "note-a", expected: { epistemicStatus: ["speculation"] } }],
      ["note-b", { noteId: "note-b", expected: { epistemicStatus: ["observation"] } }],
    ]);
    expect(epistemicPreservation(claims, gtMap)).toBe(1);
  });

  it("no match returns 0", () => {
    const claims = [makeClaim("note-a", "established")];
    const gtMap = new Map<string, GroundTruth>([
      ["note-a", { noteId: "note-a", expected: { epistemicStatus: ["speculation"] } }],
    ]);
    expect(epistemicPreservation(claims, gtMap)).toBe(0);
  });

  it("missing GT entries are ignored", () => {
    const claims = [makeClaim("orphan", "speculation")];
    const gtMap = new Map<string, GroundTruth>();
    expect(epistemicPreservation(claims, gtMap)).toBe(0);
  });
});

describe("adversarialPassRate", () => {
  it("known pass/fail mix", () => {
    const r: ProbeResult[] = [
      { name: "a", passed: true, reason: "" },
      { name: "b", passed: false, reason: "" },
      { name: "c", passed: true, reason: "" },
      { name: "d", passed: false, reason: "" },
    ];
    expect(adversarialPassRate(r)).toBe(0.5);
  });
  it("all pass returns 1", () => {
    expect(adversarialPassRate([{ name: "x", passed: true, reason: "" }])).toBe(1);
  });
  it("empty returns 0", () => {
    expect(adversarialPassRate([])).toBe(0);
  });
});

describe("noveltyScore", () => {
  it("synthesis whose body is not contained in source returns 1", () => {
    const atoms = [makeAtom({ title: "A", body: "alpha" }), makeAtom({ title: "B", body: "beta" })];
    const s = [makeSynthesis("deductive")];
    s[0].body = "novel insight not present in atoms";
    expect(noveltyScore(atoms, s)).toBe(1);
  });

  it("empty syntheses returns 0", () => {
    expect(noveltyScore([], [])).toBe(0);
  });
});

describe("observationAtomRatio", () => {
  it("counts observational atoms", () => {
    const atoms = [
      makeAtom({ atomType: "observational" }),
      makeAtom({ atomType: "observational" }),
      makeAtom({ atomType: "causal" }),
      makeAtom({ atomType: "mechanistic" }),
    ];
    expect(observationAtomRatio(atoms)).toBe(0.5);
  });
  it("empty returns 0", () => {
    expect(observationAtomRatio([])).toBe(0);
  });
});
