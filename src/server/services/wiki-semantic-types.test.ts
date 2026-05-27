// 提案 v4 Phase 1 の意味的な型（claimRole / atomType / synthesisMode /
// hypothesisStatus）の LLM 出力パースを検証する。
// - 認識可能な値: そのまま採用される
// - 認識不能な値 / 欠落: undefined（後方互換）
// - hypothesisStatus 欠落: synthesisMode があれば "speculative" にフォールバック

import { describe, it, expect } from "vitest";
import { parseIngesterOutput, parseProcedureContext } from "./wiki-ingester";
import { parseAtomizerOutput } from "./wiki-atomizer";

describe("parseProcedureContext", () => {
  it("typical full structure を保持する", () => {
    const out = parseProcedureContext({
      derivedFromNotes: ["note-1"],
      protocolFingerprint: "alloy → SPS",
      keyParameters: [
        { name: "Time", value: "3h", necessity: "critical" },
        { name: "Temp", value: "850°C", necessity: "important" },
      ],
      keyTools: ["BallMill", "SPS"],
      validityRange: "Time 1-5h, Temp 800-900°C",
    });
    expect(out).toMatchObject({
      derivedFromNotes: ["note-1"],
      protocolFingerprint: "alloy → SPS",
      keyTools: ["BallMill", "SPS"],
      validityRange: "Time 1-5h, Temp 800-900°C",
    });
    expect(out?.keyParameters).toHaveLength(2);
  });

  it("不正な necessity は important にフォールバック", () => {
    const out = parseProcedureContext({
      keyParameters: [{ name: "X", value: "1", necessity: "vital" }],
    });
    expect(out?.keyParameters?.[0].necessity).toBe("important");
  });

  it("name or value 欠落の parameter は捨てる", () => {
    const out = parseProcedureContext({
      keyParameters: [
        { name: "ok", value: "v", necessity: "critical" },
        { name: "", value: "v" },
        { name: "n", value: "" },
        { value: "v" },
      ],
    });
    expect(out?.keyParameters).toHaveLength(1);
    expect(out?.keyParameters?.[0].name).toBe("ok");
  });

  it("全フィールド欠落・空なら undefined を返す", () => {
    expect(parseProcedureContext(null)).toBeUndefined();
    expect(parseProcedureContext({})).toBeUndefined();
    expect(parseProcedureContext({ derivedFromNotes: [], keyParameters: [], keyTools: [] })).toBeUndefined();
    expect(parseProcedureContext({ protocolFingerprint: "" })).toBeUndefined();
  });

  it("string でない raw は安全に拒否", () => {
    expect(parseProcedureContext("not an object")).toBeUndefined();
    expect(parseProcedureContext(42)).toBeUndefined();
    expect(parseProcedureContext([])).toBeUndefined();
  });
});

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

// ── Phase η: epistemicStatus + lowest-status inheritance ──

describe("parseIngesterOutput: epistemicStatus (Phase η)", () => {
  it("認識可能な epistemicStatus を採用する", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        title: "Claim title",
        sections: [{ heading: "Body", content: "Content." }],
        suggestedAction: "create",
        confidence: 0.85,
        relatedClaims: [],
        externalReferences: [],
        epistemicStatus: "speculation",
      }],
    }));
    expect(out[0]?.epistemicStatus).toBe("speculation");
  });

  it("認識不能な epistemicStatus は undefined", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        title: "Claim",
        sections: [{ heading: "Body", content: "C" }],
        suggestedAction: "create",
        confidence: 0.85,
        relatedClaims: [],
        externalReferences: [],
        epistemicStatus: "certain-truth",
      }],
    }));
    expect(out[0]?.epistemicStatus).toBeUndefined();
  });

  it("epistemicStatus 欠落でもパース成功し undefined", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "claim",
        level: "finding",
        title: "C",
        sections: [{ heading: "B", content: "X" }],
        suggestedAction: "create",
        confidence: 0.85,
        relatedClaims: [],
        externalReferences: [],
      }],
    }));
    expect(out[0]?.epistemicStatus).toBeUndefined();
  });

  it("summary kind では epistemicStatus は undefined（claim のみ）", () => {
    const out = parseIngesterOutput(JSON.stringify({
      wikis: [{
        kind: "summary",
        title: "Summary",
        sections: [{ heading: "B", content: "X" }],
        suggestedAction: "create",
        confidence: 0.9,
        relatedClaims: [],
        externalReferences: [],
        epistemicStatus: "speculation", // 無視されるはず
      }],
    }));
    expect(out[0]?.kind).toBe("summary");
    expect(out[0]?.epistemicStatus).toBeUndefined();
  });
});

describe("parseAtomizerOutput: lowest-status inheritance (Phase η)", () => {
  const conceptIds = new Map([
    ["c1", "Concept 1"],
    ["c2", "Concept 2"],
    ["c3", "Concept 3"],
  ]);

  it("source の最低 status を Atom の status に強制 (LLM が established と出しても speculation 入力なら speculation)", () => {
    const statusMap = new Map<string, "speculation" | "interpretation" | "observation" | "established" | undefined>([
      ["c1", "speculation"],
      ["c2", "observation"],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{
          title: "Atom",
          body: "B",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.85,
          atomType: "causal",
          epistemicStatus: "established", // LLM が嘘をついても無視される
        }],
      }),
      conceptIds,
      statusMap,
    );
    expect(out[0]?.epistemicStatus).toBe("speculation");
  });

  it("全て observation の入力なら Atom も observation", () => {
    const statusMap = new Map<string, "speculation" | "interpretation" | "observation" | "established" | undefined>([
      ["c1", "observation"],
      ["c2", "observation"],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{
          title: "A", body: "B", sourceConceptIds: ["c1", "c2"], confidence: 0.85, atomType: "observational",
        }],
      }),
      conceptIds,
      statusMap,
    );
    expect(out[0]?.epistemicStatus).toBe("observation");
  });

  it("status map なし (legacy 呼び出し) なら LLM 出力をそのまま採用", () => {
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{
          title: "A", body: "B", sourceConceptIds: ["c1", "c2"], confidence: 0.85, atomType: "causal",
          epistemicStatus: "observation",
        }],
      }),
      conceptIds,
    );
    expect(out[0]?.epistemicStatus).toBe("observation");
  });

  it("status map あり / source 全 undefined → interpretation (中立デフォルト)", () => {
    const statusMap = new Map<string, "speculation" | "interpretation" | "observation" | "established" | undefined>([
      ["c1", undefined],
      ["c2", undefined],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{
          title: "A", body: "B", sourceConceptIds: ["c1", "c2"], confidence: 0.85,
        }],
      }),
      conceptIds,
      statusMap,
    );
    expect(out[0]?.epistemicStatus).toBe("interpretation");
  });
});

// ── Phase γ: Toulmin Rebuttal / Backing / Modal qualifier ──

describe("parseIngesterOutput: rebuttalConditions (Phase γ)", () => {
  it("string 配列の rebuttalConditions を Claim に拾う", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "塩基性条件で律速段階が切り替わる",
            sections: [{ heading: "", content: "..." }],
            epistemicStatus: "observation",
            rebuttalConditions: ["ただし反応温度が分解点を超える場合は逆効果になる"],
          },
        ],
      }),
    );
    expect(out[0]?.rebuttalConditions).toEqual([
      "ただし反応温度が分解点を超える場合は逆効果になる",
    ]);
  });

  it("rebuttalConditions が空配列なら undefined に正規化する", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "ある主張",
            sections: [{ heading: "", content: "..." }],
            rebuttalConditions: [],
          },
        ],
      }),
    );
    expect(out[0]?.rebuttalConditions).toBeUndefined();
  });

  it("非文字列要素 / 空白要素 / 重複は捨てる", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            rebuttalConditions: ["limit A", "", "  ", 42, "limit A", "limit B"],
          },
        ],
      }),
    );
    expect(out[0]?.rebuttalConditions).toEqual(["limit A", "limit B"]);
  });

  it("summary には rebuttalConditions を載せない（Claim 専用）", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "summary",
            title: "S",
            sections: [{ heading: "", content: "..." }],
            rebuttalConditions: ["should not be picked up"],
          },
        ],
      }),
    );
    expect(out[0]?.rebuttalConditions).toBeUndefined();
  });
});

describe("parseIngesterOutput: backing (Phase γ)", () => {
  it("認識可能な source を拾い、citation を整形する", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            backing: [
              { source: "textbook", citation: "Marcus 理論" },
              { source: "external-paper", citation: "rate measurement", url: "https://example.com" },
              { source: "internal-claim", citation: "previous claim", internalClaimId: "c-1" },
            ],
          },
        ],
      }),
    );
    expect(out[0]?.backing).toHaveLength(3);
    expect(out[0]?.backing?.[0]).toMatchObject({ source: "textbook", citation: "Marcus 理論" });
    expect(out[0]?.backing?.[1]?.url).toBe("https://example.com");
    expect(out[0]?.backing?.[2]?.internalClaimId).toBe("c-1");
  });

  it("source が fixed vocabulary 外なら entry を捨てる", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            backing: [
              { source: "blog-post", citation: "should be dropped" },
              { source: "textbook", citation: "kept" },
            ],
          },
        ],
      }),
    );
    expect(out[0]?.backing).toHaveLength(1);
    expect(out[0]?.backing?.[0]?.citation).toBe("kept");
  });

  it("citation が空の entry は捨てる", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            backing: [
              { source: "textbook", citation: "" },
              { source: "textbook", citation: "kept" },
            ],
          },
        ],
      }),
    );
    expect(out[0]?.backing).toHaveLength(1);
  });

  it("backing 全要素が無効なら undefined になる", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            backing: [{ source: "blog-post", citation: "x" }],
          },
        ],
      }),
    );
    expect(out[0]?.backing).toBeUndefined();
  });
});

describe("parseIngesterOutput: modalQualifier (Phase γ)", () => {
  it.each([
    ["necessarily"],
    ["probably"],
    ["possibly"],
    ["rarely"],
  ])("認識可能な値 %s を採用する", (value) => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            modalQualifier: value,
          },
        ],
      }),
    );
    expect(out[0]?.modalQualifier).toBe(value);
  });

  it("不明な値は undefined に倒す（保守的フィルタ）", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "claim",
            title: "T",
            sections: [{ heading: "", content: "..." }],
            modalQualifier: "maybe",
          },
        ],
      }),
    );
    expect(out[0]?.modalQualifier).toBeUndefined();
  });

  it("summary には modalQualifier を載せない", () => {
    const out = parseIngesterOutput(
      JSON.stringify({
        wikis: [
          {
            kind: "summary",
            title: "S",
            sections: [{ heading: "", content: "..." }],
            modalQualifier: "necessarily",
          },
        ],
      }),
    );
    expect(out[0]?.modalQualifier).toBeUndefined();
  });
});

describe("parseAtomizerOutput: shared rebuttal propagation (Phase γ)", () => {
  const idToTitle = new Map<string, string>([
    ["c-1", "Claim 1"],
    ["c-2", "Claim 2"],
    ["c-3", "Claim 3"],
  ]);

  const baseAtom = {
    title: "Atom",
    body: "body",
    sourceConceptIds: ["c-1", "c-2"],
    confidence: 0.9,
  };

  it("2+ source Claim が rebuttal を持つ場合は伝播する", () => {
    const rebuttalsBySource = new Map<string, string[] | undefined>([
      ["c-1", ["above 80°C catalyst decays"]],
      ["c-2", ["above 80°C reaction inverts"]],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [
          { ...baseAtom, rebuttalConditions: ["処理温度が高すぎる領域では効果が逆転する"] },
        ],
      }),
      idToTitle,
      undefined,
      rebuttalsBySource,
    );
    expect(out[0]?.rebuttalConditions).toEqual([
      "処理温度が高すぎる領域では効果が逆転する",
    ]);
  });

  it("1 source Claim のみ rebuttal を持つ場合は伝播しない（undefined に倒す）", () => {
    const rebuttalsBySource = new Map<string, string[] | undefined>([
      ["c-1", ["above 80°C catalyst decays"]],
      ["c-2", undefined],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [
          { ...baseAtom, rebuttalConditions: ["LLM が誤って伝播させた rebuttal"] },
        ],
      }),
      idToTitle,
      undefined,
      rebuttalsBySource,
    );
    expect(out[0]?.rebuttalConditions).toBeUndefined();
  });

  it("source map なしの場合は LLM 出力をそのまま採用する（後方互換）", () => {
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{ ...baseAtom, rebuttalConditions: ["fallback rebuttal"] }],
      }),
      idToTitle,
    );
    expect(out[0]?.rebuttalConditions).toEqual(["fallback rebuttal"]);
  });

  it("rebuttalConditions が無ければ undefined のまま", () => {
    const out = parseAtomizerOutput(
      JSON.stringify({ atoms: [baseAtom] }),
      idToTitle,
    );
    expect(out[0]?.rebuttalConditions).toBeUndefined();
  });

  it("LLM 出力の rebuttal が空配列なら、source が条件を満たしても伝播しない", () => {
    const rebuttalsBySource = new Map<string, string[] | undefined>([
      ["c-1", ["limit A"]],
      ["c-2", ["limit B"]],
    ]);
    const out = parseAtomizerOutput(
      JSON.stringify({
        atoms: [{ ...baseAtom, rebuttalConditions: [] }],
      }),
      idToTitle,
      undefined,
      rebuttalsBySource,
    );
    expect(out[0]?.rebuttalConditions).toBeUndefined();
  });
});
