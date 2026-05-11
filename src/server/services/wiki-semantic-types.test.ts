// 提案 v4 Phase 1 の意味的な型（claimRole / atomType / synthesisMode /
// hypothesisStatus）の LLM 出力パースを検証する。
// - 認識可能な値: そのまま採用される
// - 認識不能な値 / 欠落: undefined（後方互換）
// - hypothesisStatus 欠落: synthesisMode があれば "speculative" にフォールバック

import { describe, it, expect } from "vitest";
import { parseIngesterOutput } from "./wiki-ingester";
import { parseAtomizerOutput } from "./wiki-atomizer";
import { parseSynthesizerOutput } from "./wiki-synthesizer";

describe("parseIngesterOutput: claimRole", () => {
  it("認識可能な研究プロセス役割を配列で受け取る", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        claimRole: ["finding", "anomaly"],
        title: "Concept",
        sections: [{ heading: "h", content: "c" }],
        suggestedAction: "create",
        confidence: 0.9,
      }],
    }));
    expect(out).toHaveLength(1);
    expect(out[0]?.claimRole).toEqual(["finding", "anomaly"]);
  });

  it("認識不能な値は無視され、有効な値だけ残る", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        claimRole: ["finding", "garbage", "issue"],
        title: "Concept",
        sections: [{ heading: "h", content: "c" }],
        suggestedAction: "create",
        confidence: 0.9,
      }],
    }));
    expect(out[0]?.claimRole).toEqual(["finding", "issue"]);
  });

  it("claimRole 欠落でもパースが落ちず、フィールドは undefined", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        title: "Concept",
        sections: [{ heading: "h", content: "c" }],
        suggestedAction: "create",
        confidence: 0.9,
      }],
    }));
    expect(out[0]?.claimRole).toBeUndefined();
  });

  it("summary kind では claimRole を無視する", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "summary",
        claimRole: ["finding"],
        title: "Summary",
        sections: [{ heading: "h", content: "c" }],
        suggestedAction: "create",
        confidence: 0.9,
      }],
    }));
    expect(out[0]?.claimRole).toBeUndefined();
  });

  it("重複した役割は dedupe される", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        claimRole: ["finding", "finding", "anomaly"],
        title: "Concept",
        sections: [{ heading: "h", content: "c" }],
        suggestedAction: "create",
        confidence: 0.9,
      }],
    }));
    expect(out[0]?.claimRole).toEqual(["finding", "anomaly"]);
  });
});

describe("parseAtomizerOutput: atomType", () => {
  const conceptIds = new Map([
    ["c1", "Concept 1"],
    ["c2", "Concept 2"],
  ]);

  it("認識可能な atomType を採用する", () => {
    const out = parseAtomizerOutput(JSON.stringify({
      atoms: [{
        title: "Atom title",
        body: "Body of the atom.",
        sourceConceptIds: ["c1", "c2"],
        confidence: 0.8,
        atomType: "mechanistic",
      }],
    }), conceptIds);
    expect(out[0]?.atomType).toBe("mechanistic");
  });

  it("認識不能な atomType は undefined にフォールバック", () => {
    const out = parseAtomizerOutput(JSON.stringify({
      atoms: [{
        title: "Atom title",
        body: "Body.",
        sourceConceptIds: ["c1", "c2"],
        confidence: 0.8,
        atomType: "telepathic",
      }],
    }), conceptIds);
    expect(out[0]).toBeDefined();
    expect(out[0]?.atomType).toBeUndefined();
  });

  it("atomType 欠落でもパース成功し undefined", () => {
    const out = parseAtomizerOutput(JSON.stringify({
      atoms: [{
        title: "Atom",
        body: "B",
        sourceConceptIds: ["c1", "c2"],
        confidence: 0.8,
      }],
    }), conceptIds);
    expect(out[0]?.atomType).toBeUndefined();
  });
});

describe("parseSynthesizerOutput: synthesisMode + hypothesisStatus", () => {
  const baseCandidate = (overrides: Record<string, unknown> = {}) => ({
    sourceConceptIds: ["c1", "c2"],
    sourceConceptTitles: ["Concept 1", "Concept 2"],
    title: "Synthesis",
    sections: [{ heading: "h", content: "c" }],
    rationale: "Why",
    confidence: 0.9,
    ...overrides,
  });

  it("認識可能な mode と status を採用する", () => {
    const out = parseSynthesizerOutput(JSON.stringify({
      candidates: [baseCandidate({ synthesisMode: "abductive", hypothesisStatus: "tested" })],
    }));
    expect(out[0]?.synthesisMode).toBe("abductive");
    expect(out[0]?.hypothesisStatus).toBe("tested");
  });

  it("mode 認識可能 / status 欠落 → speculative にフォールバック", () => {
    const out = parseSynthesizerOutput(JSON.stringify({
      candidates: [baseCandidate({ synthesisMode: "dialectic" })],
    }));
    expect(out[0]?.synthesisMode).toBe("dialectic");
    expect(out[0]?.hypothesisStatus).toBe("speculative");
  });

  it("mode 不正・status 不正 → 両方 undefined（フォールバック条件を満たさない）", () => {
    const out = parseSynthesizerOutput(JSON.stringify({
      candidates: [baseCandidate({ synthesisMode: "magic", hypothesisStatus: "obvious" })],
    }));
    expect(out[0]?.synthesisMode).toBeUndefined();
    expect(out[0]?.hypothesisStatus).toBeUndefined();
  });

  it("両フィールド欠落でもパース成功", () => {
    const out = parseSynthesizerOutput(JSON.stringify({
      candidates: [baseCandidate()],
    }));
    expect(out[0]?.synthesisMode).toBeUndefined();
    expect(out[0]?.hypothesisStatus).toBeUndefined();
  });
});
