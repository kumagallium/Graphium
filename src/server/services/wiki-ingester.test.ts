// wiki-ingester の Tier 1 unit test（LLM 呼び出しなし）
//
// 話題（topic）関連の 2 点を中心に検証する:
//   1. parseTopics: 非文字列 / 空文字 / 重複を落とす（件数の上限は無い）
//   2. parseIngesterOutput: claim のみ topics を残し、summary は要素ごと捨てる（PR3）
//   3. buildIngesterSystemPrompt: 既存話題一覧がプロンプトに反映される

import { describe, it, expect, vi } from "vitest";
import {
  parseTopics,
  parseIngesterOutput,
  buildIngesterSystemPrompt,
  buildFrameInstructions,
  parseDecisionFrame,
  parseRuleFrame,
  parseObservationFrame,
  parseFrameValue,
  type ExistingWikiInfo,
} from "./wiki-ingester.ts";

describe("parseTopics", () => {
  it("非配列・undefined は undefined を返す", () => {
    expect(parseTopics(undefined)).toBeUndefined();
    expect(parseTopics(null)).toBeUndefined();
    expect(parseTopics("not-an-array")).toBeUndefined();
  });

  it("非文字列要素・空文字（trim 後）を落とす", () => {
    expect(parseTopics(["有効な話題", 123, null, "  ", ""])).toEqual(["有効な話題"]);
  });

  it("前後空白を trim する", () => {
    expect(parseTopics(["  話題A  "])).toEqual(["話題A"]);
  });

  it("NFC 正規化・大小文字違いの重複を落とす（最初の表記を残す）", () => {
    const composed = "が"; // NFC 合成済み
    const decomposed = "が"; // か + 濁点結合文字（NFC で "が" と同じ）
    expect(parseTopics([composed, decomposed])).toEqual([composed]);
    expect(parseTopics(["SPS Sintering", "sps sintering"])).toEqual(["SPS Sintering"]);
  });

  it("件数の上限は設けない（切り詰めない）", () => {
    expect(parseTopics(["a", "b", "c", "d", "e"])).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("結果が 0 件なら undefined（空配列を保存しない）", () => {
    expect(parseTopics([])).toBeUndefined();
    expect(parseTopics(["", "  "])).toBeUndefined();
  });
});

describe("parseIngesterOutput - topics", () => {
  const wrap = (wikis: unknown) => JSON.stringify({ wikis });

  it("LLM が topics を返しても無視する（トピックはもう知見から作らない）", () => {
    const text = wrap([
      {
        kind: "claim",
        title: "還元反応が加速する",
        topics: ["還元の反応速度", "還元の反応速度", "  pH 依存性  "],
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const [out] = parseIngesterOutput(text);
    expect(out.kind).toBe("claim");
    expect(out.topics).toBeUndefined();
  });

  it("summary は要素ごと捨てる（PR3: 新規生成停止。LLM が指示に反して出しても無視）", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = wrap([
      {
        kind: "summary",
        title: "ノート要約",
        topics: ["混入した話題名"],
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.5,
        relatedClaims: [],
        externalReferences: [],
      },
      {
        kind: "claim",
        title: "同時に出た知見",
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const out = parseIngesterOutput(text);
    // summary は捨てられ、claim だけが残る
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("claim");
    expect(out.some((w) => w.kind === "summary")).toBe(false);
    // 捨てた件数（1件）を警告として出す
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("1"));
    warnSpy.mockRestore();
  });

  it("topics 未出力の claim では undefined のまま（従来通り動作）", () => {
    const text = wrap([
      {
        kind: "claim",
        title: "話題を出さない claim",
        sections: [{ heading: "", content: "本文" }],
        suggestedAction: "create",
        confidence: 0.8,
        relatedClaims: [],
        externalReferences: [],
      },
    ]);
    const [out] = parseIngesterOutput(text);
    expect(out.topics).toBeUndefined();
  });
});

describe("buildIngesterSystemPrompt - 話題（topic）はもう ingester の材料にしない", () => {
  it("既存の topic kind エントリは Existing Wikis の一覧にだけ現れ、専用の Topics セクションは無い", () => {
    const existingWikis: ExistingWikiInfo[] = [
      { id: "topic-1", title: "還元の反応速度", kind: "topic" },
      { id: "claim-1", title: "ある知見", kind: "claim" },
    ];
    const prompt = buildIngesterSystemPrompt("ja", existingWikis);
    // 既存 wiki 一覧（[kind] title (id: ...)）には出る
    expect(prompt).toContain("[topic] 還元の反応速度 (id: topic-1)");
    // 話題を振り分けさせる専用セクションはもう無い（トピックは資料を直接読む Topic Router が担う）
    expect(prompt).not.toMatch(/## Topics\b/);
    expect(prompt).not.toMatch(/Topics \(existing\)/);
  });

  it("Claim の出力スキーマから topics フィールドが消えている", () => {
    const prompt = buildIngesterSystemPrompt("en", []);
    expect(prompt).not.toContain('"topics"');
  });
});

// ── frame（判断・規則・観察）の原文照合 ──

const NOTE =
  "ボールミル粉砕は κ_lat を下げるが、Cu 空孔経由で S も下げる。焼結温度は 800 ℃ とした。" +
  "粒径が揃わなかったため、再度粉砕して 2 時間延長することにした。試料 A の κ_lat は 0.8 W/mK だった。";
const SRC = [NOTE];

describe("buildFrameInstructions", () => {
  it("4 節と Do NOT invent を含み、プロンプトに組み込まれる", () => {
    const t = buildFrameInstructions();
    for (const h of ["## Statement form", "## Decision frame", "## Rule frame", "## Observation frame"]) {
      expect(t).toContain(h);
    }
    expect(t).toContain("Do NOT invent a rationale");
    expect(t).toContain("omit the key entirely");
    expect(buildIngesterSystemPrompt("ja", [])).toContain("## Decision frame");
  });
  it("4 節すべてに Do NOT invent を含む", () => {
    const parts = buildFrameInstructions().split("\n## ");
    expect(parts).toHaveLength(4);
    for (const part of parts) expect(part).toContain("Do NOT invent");
  });
});

describe("parseDecisionFrame", () => {
  const ok = {
    triggerTitles: ["粒径が揃わない", "粒径が揃わない", "", 3],
    action: "再度粉砕して 2 時間延長する",
    rationale: "粒径が揃わなかったため",
  };
  it("原文にある action / rationale は残り、triggerTitles はサニタイズされる", () => {
    const r = parseDecisionFrame(ok, ["decision"], SRC);
    expect(r.dropped).toBe(0);
    expect(r.frame?.rationale).toBe("粒径が揃わなかったため");
    expect(r.frame?.triggerTitles).toEqual(["粒径が揃わない"]);
  });
  it("rationale が原文に無ければ null（+1）", () => {
    const r = parseDecisionFrame({ ...ok, rationale: "装置の経年劣化を考慮したため" }, ["decision"], SRC);
    expect(r.frame?.rationale).toBeNull();
    expect(r.dropped).toBe(1);
  });
  it("action が原文に無ければ frame 全体を捨てる（+1）", () => {
    const r = parseDecisionFrame({ ...ok, action: "別の方針に切り替える" }, ["decision"], SRC);
    expect(r.frame).toBeUndefined();
    expect(r.dropped).toBe(1);
  });
  it("rationale が action と同一なら null（+1）", () => {
    const r = parseDecisionFrame({ ...ok, rationale: ok.action }, ["decision"], SRC);
    expect(r.frame?.rationale).toBeNull();
    expect(r.dropped).toBe(1);
  });
  it("rationale が action に包含されても null（+1）", () => {
    const r = parseDecisionFrame({ ...ok, rationale: "再度粉砕して 2 時間" }, ["decision"], SRC);
    expect(r.frame?.rationale).toBeNull();
    expect(r.dropped).toBe(1);
  });
  it("rationale が無い（null / 省略）なら落とさず null", () => {
    const r = parseDecisionFrame({ ...ok, rationale: null }, ["decision"], SRC);
    expect(r.frame?.rationale).toBeNull();
    expect(r.dropped).toBe(0);
  });
  it("action が 6 文字未満なら frame を捨てる", () => {
    const r = parseDecisionFrame({ ...ok, action: "再度粉砕" }, ["decision"], SRC);
    expect(r.frame).toBeUndefined();
  });
  it("claimRole に decision が無ければ捨てる（+1）", () => {
    const r = parseDecisionFrame(ok, ["finding"], SRC);
    expect(r.frame).toBeUndefined();
    expect(r.dropped).toBe(1);
    expect(parseDecisionFrame(ok, undefined, SRC).dropped).toBe(1);
  });
  it("frame が無ければ何も数えない", () => {
    expect(parseDecisionFrame(undefined, ["decision"], SRC)).toEqual({ dropped: 0 });
  });
});

describe("parseFrameValue", () => {
  const span = "ボールミル粉砕は κ_lat を下げる";
  it("span 内に item があれば残り、語彙外 comparator は undefined で項目は残る", () => {
    const r = parseFrameValue({ item: "κ_lat", comparator: "bogus", span }, SRC);
    expect(r.value).toEqual({ item: "κ_lat", span });
    expect(r.dropped).toBe(0);
  });
  it("comparator が語彙内なら残る", () => {
    expect(parseFrameValue({ item: "κ_lat", comparator: "decreases", span }, SRC).value?.comparator).toBe("decreases");
  });
  it("span が原文に無ければ捨てる（+1）", () => {
    const r = parseFrameValue({ item: "κ_lat", span: "格子熱伝導率が大きく低下した" }, SRC);
    expect(r.value).toBeUndefined();
    expect(r.dropped).toBe(1);
  });
  it("item が span 内に無ければ捨てる（+1）", () => {
    expect(parseFrameValue({ item: "処理", span }, SRC).dropped).toBe(1);
  });
  it("value（文字列）が span 内に無ければ捨てる", () => {
    expect(parseFrameValue({ item: "κ_lat", value: "焼結", span }, SRC).dropped).toBe(1);
  });
  it("value（数値）と unit は span 内で照合される", () => {
    const s2 = "試料 A の κ_lat は 0.8 W/mK だった";
    const good = parseFrameValue({ item: "κ_lat", comparator: "eq", value: 0.8, unit: "W/mK", span: s2 }, SRC);
    expect(good.value?.value).toBe(0.8);
    expect(parseFrameValue({ item: "κ_lat", value: 0.9, span: s2 }, SRC).dropped).toBe(1);
    expect(parseFrameValue({ item: "κ_lat", value: 0.8, unit: "kPa", span: s2 }, SRC).dropped).toBe(1);
  });
  it("span が 6 文字未満なら捨てる", () => {
    expect(parseFrameValue({ item: "S", span: "S も下げ" }, SRC).dropped).toBe(1);
  });
  it("出典が複数のとき、継ぎ目をまたぐ span は捨てる", () => {
    const r = parseFrameValue({ item: "alpha", span: "alphabeta-gamma" }, ["xx alphabeta", "-gamma yy"]);
    expect(r.dropped).toBe(1);
  });
});

describe("parseRuleFrame", () => {
  const raw = {
    conditions: [{ item: "ボールミル粉砕", comparator: "present", span: "ボールミル粉砕は κ_lat を下げる" }],
    consequences: [
      { item: "κ_lat", comparator: "decreases", span: "ボールミル粉砕は κ_lat を下げる" },
      { item: "S", comparator: "decreases", span: "Cu 空孔経由で S も下げる" },
    ],
    mechanism: "Cu 空孔経由",
  };
  it("正常系: general なら全て残る", () => {
    const r = parseRuleFrame(raw, "general", SRC);
    expect(r.dropped).toBe(0);
    expect(r.frame?.consequences).toHaveLength(2);
    expect(r.frame?.mechanism).toBe("Cu 空孔経由");
  });
  it("statementForm が general でなければ捨てる（+1）", () => {
    expect(parseRuleFrame(raw, "instance", SRC)).toEqual({ dropped: 1 });
    expect(parseRuleFrame(raw, undefined, SRC).frame).toBeUndefined();
  });
  it("mechanism が原文に無ければ削除（+1）", () => {
    const r = parseRuleFrame({ ...raw, mechanism: "転位の増殖による散乱" }, "general", SRC);
    expect(r.frame?.mechanism).toBeUndefined();
    expect(r.dropped).toBe(1);
  });
  it("不正な項目だけ捨てる（+1）", () => {
    const bad = { item: "κ_lat", span: "原文に無い長い引用です" };
    const r = parseRuleFrame({ ...raw, consequences: [...raw.consequences, bad] }, "general", SRC);
    expect(r.frame?.consequences).toHaveLength(2);
    expect(r.dropped).toBe(1);
  });
  it("条件・帰結が全部空なら frame を undefined", () => {
    const r = parseRuleFrame({ conditions: [], consequences: [{ item: "x", span: "嘘の引用文ですよ" }] }, "general", SRC);
    expect(r.frame).toBeUndefined();
    expect(r.dropped).toBeGreaterThan(0);
  });
});

describe("parseObservationFrame", () => {
  const raw = {
    featureOfInterest: "試料 A",
    results: [{ item: "κ_lat", comparator: "eq", value: 0.8, unit: "W/mK", span: "試料 A の κ_lat は 0.8 W/mK だった" }],
  };
  it("instance かつ observation なら残る", () => {
    const r = parseObservationFrame(raw, "instance", "observation", SRC);
    expect(r.dropped).toBe(0);
    expect(r.frame?.featureOfInterest).toBe("試料 A");
    expect(r.frame?.results).toHaveLength(1);
  });
  it("statementForm が instance でなければ捨てる（+1）", () => {
    expect(parseObservationFrame(raw, "general", "observation", SRC)).toEqual({ dropped: 1 });
  });
  it("epistemicStatus が observation でなければ捨てる（+1）", () => {
    expect(parseObservationFrame(raw, "instance", "interpretation", SRC)).toEqual({ dropped: 1 });
  });
  it("featureOfInterest が原文に無ければ削除（+1）", () => {
    const r = parseObservationFrame({ ...raw, featureOfInterest: "試料 Z" }, "instance", "observation", SRC);
    expect(r.frame?.featureOfInterest).toBeUndefined();
    expect(r.frame?.results).toHaveLength(1);
    expect(r.dropped).toBe(1);
  });
  it("results が全部空なら frame を undefined", () => {
    const r = parseObservationFrame({ ...raw, results: [] }, "instance", "observation", SRC);
    expect(r.frame).toBeUndefined();
  });
});

describe("parseIngesterOutput の frame 統合", () => {
  const claim = (extra: Record<string, unknown>) =>
    JSON.stringify({
      wikis: [
        {
          kind: "claim",
          title: "t",
          sections: [{ heading: "h", content: "c" }],
          claimRole: ["decision"],
          epistemicStatus: "observation",
          statementForm: "instance",
          decisionFrame: {
            triggerTitles: [],
            action: "再度粉砕して 2 時間延長する",
            rationale: "装置の経年劣化を考慮したため",
          },
          ...extra,
        },
      ],
    });
  it("sources 省略（fail-closed）なら frame を全て捨て、件数を数える", () => {
    const [w] = parseIngesterOutput(claim({}));
    expect(w.decisionFrame).toBeUndefined();
    expect(w.droppedFrames).toBe(1);
    expect(w.statementForm).toBe("instance");
  });
  it("sources ありなら照合して droppedFrames に合算、0 なら undefined", () => {
    const [w] = parseIngesterOutput(claim({}), SRC);
    expect(w.decisionFrame?.rationale).toBeNull();
    expect(w.droppedFrames).toBe(1);
    const [w2] = parseIngesterOutput(
      claim({ decisionFrame: { triggerTitles: [], action: "再度粉砕して 2 時間延長する", rationale: null } }),
      SRC,
    );
    expect(w2.droppedFrames).toBeUndefined();
  });
  it("不正な statementForm は落ち、claim 以外では frame を持たない", () => {
    const [w] = parseIngesterOutput(claim({ statementForm: "weird" }), SRC);
    expect(w.statementForm).toBeUndefined();
    const [a] = parseIngesterOutput(claim({ kind: "atom" }), SRC);
    expect(a.statementForm).toBeUndefined();
    expect(a.decisionFrame).toBeUndefined();
  });
});

describe("parseFrameValue - 数値化", () => {
  const parse = (value: unknown, span: string, extra: Record<string, unknown> = {}) =>
    parseFrameValue({ item: "温度", value, span, ...extra }, [span]).value;

  it("照合に失敗する値は分割より前に捨てられる", () => {
    const r = parseFrameValue({ item: "温度", value: "650 K", span: "温度は 700 K だった" }, ["温度は 700 K だった"]);
    expect(r.dropped).toBe(1);
  });
  it("数 + 単位の文字列は数値と単位に分かれる", () => {
    const v = parse("650 K", "温度は 650 K だった");
    expect(v?.value).toBe(650);
    expect(v?.unit).toBe("K");
  });
  it("raw.unit と食い違えば文字列のまま", () => {
    const v = parse("650 K", "温度は 650 K だった", { unit: "650" });
    expect(v?.value).toBe("650 K");
  });
  it("raw.unit が大小文字だけ違えば原文照合で項目ごと捨てる（mK を MK にしない）", () => {
    const v = parse("650 mK", "温度は 650 mK まで下がった", { unit: "MK" });
    expect(v).toBeUndefined();
  });
  it("raw.unit と一致すれば数値化して raw.unit を採用", () => {
    const v = parse("650 K", "温度は 650 K だった", { unit: "K" });
    expect(v?.value).toBe(650);
    expect(v?.unit).toBe("K");
  });
  it("comparator decreases と < が食い違えば文字列のまま", () => {
    const v = parse("< 1", "温度は < 1 になった", { comparator: "decreases" });
    expect(v?.value).toBe("< 1");
    expect(v?.comparator).toBe("decreases");
  });
  it("comparator eq は < に寄る", () => {
    const v = parse("< 1", "温度は < 1 になった", { comparator: "eq" });
    expect(v?.value).toBe(1);
    expect(v?.comparator).toBe("lt");
  });
  it("comparator が値内の記号と一致すれば分ける", () => {
    const v = parse("≥ 650 K", "温度は ≥ 650 K だった", { comparator: "ge" });
    expect(v?.value).toBe(650);
    expect(v?.unit).toBe("K");
    expect(v?.comparator).toBe("ge");
    const w = parse("< 1", "温度は < 1 になった", { comparator: "lt" });
    expect(w?.value).toBe(1);
    expect(w?.comparator).toBe("lt");
  });
  it("comparator が値内の記号と別なら文字列のまま", () => {
    const v = parse("≥ 650 K", "温度は ≥ 650 K だった", { comparator: "lt" });
    expect(v?.value).toBe("≥ 650 K");
  });
  it("number はそのまま", () => {
    expect(parse(650, "温度は 650 K だった")?.value).toBe(650);
  });
  it("分けられない文字列はそのまま", () => {
    expect(parse("600〜650", "温度は 600〜650 だった")?.value).toBe("600〜650");
  });
});

describe("parseFrameValue: 単位は大小文字を区別して照合する", () => {
  const src = ["温度は 650 mK まで下がった"];
  it("原文が mK なのに MK と書いた単位は捨てる", () => {
    const r = parseFrameValue({ item: "温度", value: "650 mK", unit: "MK", span: "温度は 650 mK まで下がった" }, src);
    expect(r.value).toBeUndefined();
    expect(r.dropped).toBe(1);
  });
  it("原文どおりの mK なら数値化される", () => {
    const r = parseFrameValue({ item: "温度", value: "650 mK", unit: "mK", span: "温度は 650 mK まで下がった" }, src);
    expect(r.value).toMatchObject({ value: 650, unit: "mK" });
  });
});
