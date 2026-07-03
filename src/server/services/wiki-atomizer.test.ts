// wiki-atomizer の Tier 1 unit test
//
// LLM 呼び出しなしで以下を assert する:
//   1. detectRung1Tokens の pattern が corpus 既出の rung-1 token を catch する
//      （関数は可視化・signal 用途のため残置。parser での silent drop は廃止）
//   2. parseAtomizerOutput は可搬性ゲート（2 件必須 / confidence 閾値 / rung-1）を
//      撤廃し、prompt の可搬性テスト一本に寄せた。parser は hallucination（未知の
//      source ID のみ）だけを落とす。
//
// 以前は LLM atomizer が "Al3V" "Klemens-Callaway" "PROV-DM" 等を捨てられない問題に
// 対し parser 側で post-emit drop していたが、「黙って消す」不透明さを排し、可搬か否かの
// 判定を prompt の一般原則（可搬性テスト）に一本化した。

import { describe, it, expect } from "vitest";
import {
  detectRung1Tokens,
  parseAtomizerOutput,
  buildAtomizerUserMessage,
  parseReliftOutput,
  buildReliftUserMessage,
  parseTransferJudgeOutput,
  buildTransferJudgeUserMessage,
  parseFoldJudgeOutput,
  buildFoldJudgeUserMessage,
  resolveFoldVerdict,
} from "./wiki-atomizer.ts";

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

describe("parseAtomizerOutput — portability gates removed (single rule = prompt portability test)", () => {
  function makeIdMap(snapshots: { id: string; title: string }[]): Map<string, string> {
    return new Map(snapshots.map((c) => [c.id, c.title]));
  }

  const baseSnapshots = [
    { id: "c1", title: "Claim 1" },
    { id: "c2", title: "Claim 2" },
  ];

  it("keeps a single-source atom (2+ Claim requirement removed)", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "命名は実践より後に来やすい",
          body: "ある実践が定着してから、それを指す名前が後付けされることが多い。",
          sourceConceptIds: ["c1"],
          confidence: 0.9,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toHaveLength(1);
    expect(out[0].derivedFromClaims).toEqual(["c1"]);
  });

  it("keeps a low-confidence atom (confidence is recorded, not a drop gate)", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "小さな介入が全体の性質を大きく変えないことがある",
          body: "一部に少量を足しても、系全体の構造的な性質はあまり動かない場合がある。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.4,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.4);
  });

  it("keeps an atom that still carries a domain token (rung-1 silent drop removed)", () => {
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
    // 可搬性の判定は prompt 側のテストに一本化。parser は黙って消さない。
    expect(out).toHaveLength(1);
    expect(out[0].title).toContain("Klemens-Callaway");
  });

  it("still drops atoms whose sourceConceptIds are all unknown (hallucination guard)", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "どこにも紐づかない主張",
          body: "存在しない Claim を参照している。",
          sourceConceptIds: ["nope", "ghost"],
          confidence: 0.9,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toEqual([]);
  });

  it("keeps multiple atoms in one batch", () => {
    const llmJson = JSON.stringify({
      atoms: [
        {
          title: "命名は実践より後に来やすい",
          body: "実践が定着してから名前が後付けされる。",
          sourceConceptIds: ["c1"],
          confidence: 0.9,
        },
        {
          title: "助触媒の担持で還元活性点が増える",
          body: "触媒の活性は分散度合いで変わる。",
          sourceConceptIds: ["c1", "c2"],
          confidence: 0.6,
        },
      ],
    });
    const out = parseAtomizerOutput(llmJson, makeIdMap(baseSnapshots));
    expect(out).toHaveLength(2);
  });
});

describe("buildAtomizerUserMessage — minimum-2 gate removed (single source allowed)", () => {
  const oneClaim = [
    { id: "c1", title: "電気陰性度差が小さいほどキャリア移動度が高い", bodyPreview: "均質な構成ほど流れが妨げられにくい。", relatedClaims: [] },
  ];

  it("builds a real atomization prompt from a single Claim (no 'minimum 2' short-circuit)", () => {
    const msg = buildAtomizerUserMessage(oneClaim, []);
    // 旧実装は < 2 で "Not enough Claim pages ... minimum 2 required" を返し、
    // 単一ソースの re-lift が無言で 0 atom になっていた。
    expect(msg).not.toContain("minimum 2");
    expect(msg).toContain("1 Claim");
    expect(msg).toContain("電気陰性度差");
    // four-step 手順を含む本物のプロンプトであることを確認
    expect(msg).toContain("decompose");
  });
});

describe("parseReliftOutput / buildReliftUserMessage — plain-language stage (C+D)", () => {
  it("parses the relift JSON and keeps index / title / body", () => {
    const json = JSON.stringify({
      atoms: [
        { index: 1, title: "合金を高温で処理すると別の相ができる", body: "本文1" },
        { index: 2, title: "性質の近い要素どうしは粒子が動きやすい", body: "本文2" },
      ],
    });
    const out = parseReliftOutput(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ index: 1, title: "合金を高温で処理すると別の相ができる", body: "本文1" });
  });

  it("tolerates a fenced json block and drops entries missing title/body", () => {
    const json =
      "```json\n" +
      JSON.stringify({ atoms: [{ index: 1, title: "ok", body: "ok" }, { index: 2, title: "no body" }] }) +
      "\n```";
    const out = parseReliftOutput(json);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("ok");
  });

  it("returns [] on malformed JSON (relift failure stays non-fatal)", () => {
    expect(parseReliftOutput("not json at all")).toEqual([]);
  });

  it("flags still-technical tokens when given, and omits the line when empty", () => {
    const withTokens = buildReliftUserMessage([
      { title: "SPS は圧力不足で…", body: "本文", jargon: ["SPS", "XRD"] },
    ]);
    expect(withTokens).toContain("[1]");
    expect(withTokens).toContain("still too technical");
    expect(withTokens).toContain("SPS, XRD");
    expect(withTokens).toContain('title: "SPS は圧力不足で…"');

    // pass 1（全 Atom・jargon 空）では技術語の指定行を付けない
    const noTokens = buildReliftUserMessage([{ title: "命名は実践より後に来る", body: "本文", jargon: [] }]);
    expect(noTokens).not.toContain("still too technical");
    expect(noTokens).toContain('title: "命名は実践より後に来る"');
  });
});

describe("parseAtomizerOutput — shape / transfer (structural abstraction)", () => {
  const idMap = new Map([["c1", "Claim 1"], ["c2", "Claim 2"]]);

  it("parses a valid shape and a complete transfer", () => {
    const json = JSON.stringify({
      atoms: [{
        title: "調整できる量は中間の最適値で性能が最大になる",
        body: "本文",
        sourceConceptIds: ["c1"],
        confidence: 0.85,
        shape: "optimal-middle",
        transfer: { field: "触媒設計", example: "吸着エネルギーが中間で反応速度が最大になる（サバティエ原理）" },
      }],
    });
    const out = parseAtomizerOutput(json, idMap);
    expect(out).toHaveLength(1);
    expect(out[0].shape).toBe("optimal-middle");
    expect(out[0].transfer).toEqual({ field: "触媒設計", example: "吸着エネルギーが中間で反応速度が最大になる（サバティエ原理）" });
  });

  it("parses feedback-loop shapes (reinforcing / balancing) added for the Idea layer", () => {
    const reinforcing = JSON.stringify({ atoms: [{ title: "使うほど価値が増す", body: "本文", sourceConceptIds: ["c1"], confidence: 0.8, shape: "reinforcing-loop" }] });
    expect(parseAtomizerOutput(reinforcing, idMap)[0].shape).toBe("reinforcing-loop");
    const balancing = JSON.stringify({ atoms: [{ title: "ずれると戻る力が働く", body: "本文", sourceConceptIds: ["c1"], confidence: 0.8, shape: "balancing-loop" }] });
    expect(parseAtomizerOutput(balancing, idMap)[0].shape).toBe("balancing-loop");
  });

  it("drops an out-of-vocabulary shape to undefined", () => {
    const json = JSON.stringify({ atoms: [{ title: "x", body: "y", sourceConceptIds: ["c1"], confidence: 0.8, shape: "wiggly" }] });
    expect(parseAtomizerOutput(json, idMap)[0].shape).toBeUndefined();
  });

  it("drops a partial transfer (missing example) to undefined", () => {
    const json = JSON.stringify({ atoms: [{ title: "x", body: "y", sourceConceptIds: ["c1"], confidence: 0.8, transfer: { field: "x" } }] });
    expect(parseAtomizerOutput(json, idMap)[0].transfer).toBeUndefined();
  });

  it("derives shapeFamily deterministically from the form, ignoring the LLM's raw family", () => {
    // form=optimal-middle は functional-dependence に属す。LLM が矛盾する family を出しても
    // form を真実源に補正する（self-heal）。
    const json = JSON.stringify({
      atoms: [{ title: "中間最適", body: "本文", sourceConceptIds: ["c1"], confidence: 0.8, shape: "optimal-middle", shapeFamily: "dynamic-feedback" }],
    });
    const out = parseAtomizerOutput(json, idMap);
    expect(out[0].shape).toBe("optimal-middle");
    expect(out[0].shapeFamily).toBe("functional-dependence"); // raw の dynamic-feedback は捨てる
  });

  it("maps each family's forms correctly (structural / conditional / dynamic-feedback)", () => {
    const comp = JSON.stringify({ atoms: [{ title: "a", body: "b", sourceConceptIds: ["c1"], confidence: 0.8, shape: "composition-structure" }] });
    expect(parseAtomizerOutput(comp, idMap)[0].shapeFamily).toBe("structural");
    const enab = JSON.stringify({ atoms: [{ title: "a", body: "b", sourceConceptIds: ["c1"], confidence: 0.8, shape: "enabling-condition" }] });
    expect(parseAtomizerOutput(enab, idMap)[0].shapeFamily).toBe("conditional");
    const loop = JSON.stringify({ atoms: [{ title: "a", body: "b", sourceConceptIds: ["c1"], confidence: 0.8, shape: "reinforcing-loop" }] });
    expect(parseAtomizerOutput(loop, idMap)[0].shapeFamily).toBe("dynamic-feedback");
  });

  it("falls back to the raw family only when the form is absent, and drops an out-of-vocab family", () => {
    // form 無し + 妥当な raw family → raw を採用。
    const valid = JSON.stringify({ atoms: [{ title: "a", body: "b", sourceConceptIds: ["c1"], confidence: 0.8, shapeFamily: "structural" }] });
    expect(parseAtomizerOutput(valid, idMap)[0].shapeFamily).toBe("structural");
    expect(parseAtomizerOutput(valid, idMap)[0].shape).toBeUndefined();
    // form 無し + 語彙外 family → undefined。
    const bad = JSON.stringify({ atoms: [{ title: "a", body: "b", sourceConceptIds: ["c1"], confidence: 0.8, shapeFamily: "wobbly" }] });
    expect(parseAtomizerOutput(bad, idMap)[0].shapeFamily).toBeUndefined();
  });
});

describe("parseTransferJudgeOutput / buildTransferJudgeUserMessage", () => {
  it("parses verdicts and coerces valid to boolean", () => {
    const json = JSON.stringify({ items: [{ index: 1, valid: true, reason: "genuine match" }, { index: 2, valid: false, reason: "topical only" }] });
    const out = parseTransferJudgeOutput(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ index: 1, valid: true, reason: "genuine match" });
    expect(out[1].valid).toBe(false);
  });

  it("returns [] on malformed JSON (judge failure → caller drops transfers conservatively)", () => {
    expect(parseTransferJudgeOutput("not json")).toEqual([]);
  });

  it("builds a judge message with principle / shape / transfer per item", () => {
    const msg = buildTransferJudgeUserMessage([{ title: "中間最適の原理", shape: "optimal-middle", field: "料理", example: "塩は中間量で旨味が最大" }]);
    expect(msg).toContain("[1]");
    expect(msg).toContain("shape: optimal-middle");
    expect(msg).toContain("transfer.field: 料理");
  });
});

describe("parseFoldJudgeOutput / buildFoldJudgeUserMessage — fold verification (co-structure)", () => {
  it("parses per-atom coherent subsets and coerces ids to trimmed strings", () => {
    const json = JSON.stringify({
      items: [
        { index: 1, coherentClaimIds: ["c1", "c3"], reason: "c1,c3 optimal-middle; c2 monotonic" },
        { index: 2, coherentClaimIds: ["c4"], reason: "only c4 instances the shape" },
      ],
    });
    const out = parseFoldJudgeOutput(json);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ index: 1, coherentClaimIds: ["c1", "c3"], reason: "c1,c3 optimal-middle; c2 monotonic" });
    expect(out[1].coherentClaimIds).toEqual(["c4"]);
  });

  it("parses an empty coherent set (judge says none cohere → caller collapses to best claim)", () => {
    const json = JSON.stringify({ items: [{ index: 1, coherentClaimIds: [], reason: "three different shapes" }] });
    const out = parseFoldJudgeOutput(json);
    expect(out).toHaveLength(1);
    expect(out[0].coherentClaimIds).toEqual([]);
  });

  it("drops non-string / empty ids inside coherentClaimIds", () => {
    const json = JSON.stringify({ items: [{ index: 1, coherentClaimIds: ["c1", "", 42, null, "  c2  "] }] });
    const out = parseFoldJudgeOutput(json);
    expect(out[0].coherentClaimIds).toEqual(["c1", "c2"]); // trimmed, non-strings dropped
  });

  it("drops rows whose coherentClaimIds is not an array (malformed → no verdict / fail-open)", () => {
    const json = JSON.stringify({ items: [{ index: 1, reason: "forgot the array" }, { index: 2, coherentClaimIds: ["c9"] }] });
    const out = parseFoldJudgeOutput(json);
    expect(out).toHaveLength(1);
    expect(out[0].index).toBe(2);
  });

  it("defaults index to 0 and reason to empty string when absent", () => {
    const json = JSON.stringify({ items: [{ coherentClaimIds: ["c1"] }] });
    const out = parseFoldJudgeOutput(json);
    expect(out[0]).toEqual({ index: 0, coherentClaimIds: ["c1"], reason: "" });
  });

  it("accepts a bare array (no items wrapper) and strips a fenced json block", () => {
    expect(parseFoldJudgeOutput(JSON.stringify([{ index: 1, coherentClaimIds: ["c1"] }]))).toHaveLength(1);
    const fenced = "```json\n" + JSON.stringify({ items: [{ index: 1, coherentClaimIds: ["c1"] }] }) + "\n```";
    expect(parseFoldJudgeOutput(fenced)[0].coherentClaimIds).toEqual(["c1"]);
  });

  it("returns [] on malformed JSON (judge failure → route fails open, keeps atoms)", () => {
    expect(parseFoldJudgeOutput("not json")).toEqual([]);
    expect(parseFoldJudgeOutput("")).toEqual([]);
  });

  it("builds a judge message with principle / shape / per-claim id+title+preview", () => {
    const msg = buildFoldJudgeUserMessage([
      {
        title: "中間の最適値で性能が最大になる",
        shape: "optimal-middle",
        claims: [
          { id: "c1", title: "塩は中間量で旨味が最大", preview: "少なすぎても多すぎても味が落ちる" },
          { id: "c2", title: "熱処理は中間温度で強度が最大", preview: "低温だと未反応、高温だと粗大化" },
        ],
      },
    ]);
    expect(msg).toContain("[1]");
    expect(msg).toContain("shape: optimal-middle");
    expect(msg).toContain("(id: c1)");
    expect(msg).toContain("塩は中間量で旨味が最大");
    expect(msg).toContain("少なすぎても多すぎても味が落ちる"); // preview surfaced
  });

  it("renders shape as (none) and omits the em-dash when preview is empty", () => {
    const msg = buildFoldJudgeUserMessage([
      { title: "x", shape: undefined, claims: [{ id: "c1", title: "t1", preview: "" }] },
    ]);
    expect(msg).toContain("shape: (none)");
    expect(msg).toContain('(id: c1) "t1"');
    expect(msg).not.toContain('"t1" —'); // no trailing " — " with empty preview
  });
});

describe("resolveFoldVerdict — subset / collapse rules", () => {
  it("no change when all sent ids cohere", () => {
    expect(resolveFoldVerdict(["c1", "c2"], ["c1", "c2"])).toEqual({ confirmed: ["c1", "c2"], dropped: 0, changed: false });
  });
  it("restricts to the coherent subset (keeping sent order)", () => {
    expect(resolveFoldVerdict(["c1", "c2", "c3"], ["c3", "c1"])).toEqual({ confirmed: ["c1", "c3"], dropped: 1, changed: true });
  });
  it("collapses to the first (best-cited) claim when none cohere", () => {
    expect(resolveFoldVerdict(["c1", "c2"], [])).toEqual({ confirmed: ["c1"], dropped: 1, changed: true });
  });
  it("ignores hallucinated ids the judge invented", () => {
    expect(resolveFoldVerdict(["c1", "c2"], ["c1", "c9"])).toEqual({ confirmed: ["c1"], dropped: 1, changed: true });
  });
  it("collapses to first when judge returns only hallucinated ids", () => {
    expect(resolveFoldVerdict(["c1", "c2"], ["zzz"])).toEqual({ confirmed: ["c1"], dropped: 1, changed: true });
  });
});
