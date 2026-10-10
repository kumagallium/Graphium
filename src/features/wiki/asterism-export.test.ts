import { describe, it, expect } from "vitest";
import type { WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import {
  expandVocabTerm,
  buildAsterismBundle,
  serializeAsterismBundle,
  type AsterismBundle,
} from "./asterism-export";

const BASE = "https://vocab.example/shared#";
const CB = "https://c.example/claim/";
const AST: AsterismSettings = {
  vocabBaseIri: BASE,
  claimBaseIri: CB,
  typeSlugs: { observation: "sosa:Observation", interpretation: "interpretation", rule: "rule", judgment: "judgment" },
};
const NOW = "2026-10-09T00:00:00.000Z";

const base = (o: Partial<WikiMeta>): WikiMeta =>
  ({ kind: "claim", derivedFromNotes: ["n1", "w1"], derivedFromChats: [], generatedAt: "2026-01-01T00:00:00Z", ...o }) as WikiMeta;

const decision = base({
  claimRole: ["decision"],
  statementForm: "instance",
  asterism: { typeSlug: "judgment", evidenceIris: ["https://e.example/1", "not a url", "ftp://x.example/a", "https://e.example/with space", "http://e.example/2"] },
  decisionFrame: {
    triggerClaimIds: ["t1"],
    action: "乾燥時間を延ばす",
    rationale: "割れを避けるため",
    rationaleRuleIds: ["r1"],
    outcomeClaimIds: ["o1"],
    outcomeAssessment: "confirmed",
    reviewState: "confirmed",
  },
});
const rule = base({
  statementForm: "general",
  asterism: { typeSlug: "rule" },
  ruleFrame: {
    conditions: [{ item: "温度", itemIri: "quantitykind:Temperature", comparator: "gt", value: 80, unit: "degC", span: "SPAN-C" }],
    consequences: [{ item: "収率", comparator: "decreases", span: "SPAN-D" }],
    mechanism: "MECH-TEXT",
    reviewState: "extracted",
  },
});
const obs = base({
  epistemicStatus: "observation",
  statementForm: "instance",
  asterism: { typeSlug: "sosa:Observation" },
  observationFrame: {
    featureOfInterest: "試料A",
    results: [{ item: "厚さ", value: "12", unit: "um", span: "SPAN-R" }],
    reviewState: "extracted",
  },
});
const inferredObs = base({
  asterism: { typeSlug: "sosa:Observation" },
  observationFrame: { results: [], reviewState: "inferred" },
});
const interp = base({ asterism: { typeSlug: "interpretation" } });

describe("expandVocabTerm", () => {
  it("slug は基底 IRI + slug、基底が空なら null", () => {
    expect(expandVocabTerm("rule", AST)).toBe(BASE + "rule");
    expect(expandVocabTerm("rule", { ...AST, vocabBaseIri: "" })).toBeNull();
  });
  it("既知 prefix の CURIE を展開し、sv: は基底を使う", () => {
    expect(expandVocabTerm("sosa:Observation", AST)).toBe("http://www.w3.org/ns/sosa/Observation");
    expect(expandVocabTerm("prov:Entity", AST)).toBe("http://www.w3.org/ns/prov#Entity");
    expect(expandVocabTerm("qudt:Unit", AST)).toBe("http://qudt.org/schema/qudt/Unit");
    expect(expandVocabTerm("quantitykind:Length", AST)).toBe("http://qudt.org/vocab/quantitykind/Length");
    expect(expandVocabTerm("sv:judgment", AST)).toBe(BASE + "judgment");
  });
  it("完全 IRI はそのまま、未知 prefix と空は null", () => {
    expect(expandVocabTerm("https://x.example/t", AST)).toBe("https://x.example/t");
    expect(expandVocabTerm("foo:bar", AST)).toBeNull();
    expect(expandVocabTerm("", AST)).toBeNull();
  });
});


const o = { includeUntyped: false, includeInferred: false, exportedAt: NOW };
const ok = (r: ReturnType<typeof buildAsterismBundle>): AsterismBundle => {
  if ("error" in r) throw new Error(r.error);
  return r;
};
const PARENT_KEYS = [
  "id", "iri", "type", "type_term", "title", "statement_form", "claim_role", "epistemic_status",
  "trigger_iri", "action", "rationale", "rationale_rule_iri", "outcome_iri", "outcome_assessment",
  "feature_of_interest", "evidence", "review_state", "source_note", "generated_at", "exported_at",
];
const items = [
  { id: "d", meta: decision, title: "D" },
  { id: "r", meta: rule },
  { id: "o", meta: obs },
  { id: "i", meta: interp },
  { id: "u", meta: base({}) },
  { id: "t", meta: base({ kind: "topic" }) },
];

describe("buildAsterismBundle", () => {
  it("claimBaseIri が空（空白のみ含む）ならエラー", () => {
    expect(buildAsterismBundle(items, { ...AST, claimBaseIri: "" }, o)).toEqual({ error: "claim-base-iri-required" });
    expect(buildAsterismBundle(items, { ...AST, claimBaseIri: "  " }, o)).toEqual({ error: "claim-base-iri-required" });
  });

  it("型ごとに振り分け、0 件のファイルは束に含めない", () => {
    const b = ok(buildAsterismBundle(items, AST, { ...o, includeInferred: true }));
    expect(Object.keys(b.files).sort()).toEqual(
      ["interpretations.json", "judgments.json", "observation_terms.json", "observations.json", "rule_terms.json", "rules.json"],
    );
    expect(b.files["judgments.json"].map((r) => (r as { id: string }).id)).toEqual(["d"]);
    expect(b.files["rules.json"].map((r) => (r as { id: string }).id)).toEqual(["r"]);
    expect(b.files["observations.json"].map((r) => (r as { id: string }).id)).toEqual(["o"]);
    expect(b.files["interpretations.json"].map((r) => (r as { id: string }).id)).toEqual(["i"]);
    expect(b.files).not.toHaveProperty("untyped.json");
    expect(b.counts).toEqual({
      "judgments.json": 1,
      "rules.json": 1,
      "observations.json": 1,
      "interpretations.json": 1,
      "rule_terms.json": 2,
      "observation_terms.json": 1,
    });
  });

  it("対象が無ければ files は空", () => {
    const b = ok(buildAsterismBundle([{ id: "t", meta: base({ kind: "topic" }) }], AST, o));
    expect(b.files).toEqual({});
    expect(b.counts).toEqual({});
  });

  it("includeUntyped で untyped.json（type は null）", () => {
    const b = ok(buildAsterismBundle(items, AST, { ...o, includeUntyped: true }));
    expect(b.files["untyped.json"]).toHaveLength(1);
    expect(b.files["untyped.json"][0]).toMatchObject({ id: "u", type: null, type_term: null });
  });

  it("除外理由 3 種 + 設定に無い型", () => {
    const b = ok(
      buildAsterismBundle([...items, { id: "x", meta: base({ asterism: { typeSlug: "foo" } }) }, { id: "n", meta: inferredObs }], AST, o),
    );
    expect(b.skipped).toEqual([
      { id: "u", reason: "untyped" },
      { id: "t", reason: "not-claim" },
      { id: "x", reason: "unknown-type" },
      { id: "n", reason: "inferred" },
    ]);
  });

  it("includeInferred で inferred も含まれるが、型なしは includeUntyped が要る", () => {
    const b = ok(buildAsterismBundle([{ id: "n", meta: inferredObs }, { id: "u", meta: base({}) }], AST, { ...o, includeInferred: true }));
    expect(b.files["observations.json"]).toHaveLength(1);
    expect(b.skipped).toEqual([{ id: "u", reason: "untyped" }]);
  });

  it("判断の親行: 参照は完全 IRI、evidence は有効な要素だけ、入れ子は持たない", () => {
    const b = ok(buildAsterismBundle(items, AST, o));
    const row = b.files["judgments.json"][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: "d",
      iri: CB + "d",
      type: BASE + "judgment",
      type_term: "judgment",
      title: "D",
      statement_form: "instance",
      claim_role: ["decision"],
      trigger_iri: [CB + "t1"],
      action: "乾燥時間を延ばす",
      rationale: "割れを避けるため",
      rationale_rule_iri: [CB + "r1"],
      outcome_iri: [CB + "o1"],
      outcome_assessment: "confirmed",
      evidence: ["https://e.example/1", "http://e.example/2"],
      review_state: "confirmed",
      source_note: ["n1", "w1"],
      generated_at: "2026-01-01T00:00:00Z",
      exported_at: NOW,
    });
    for (const k of ["trigger", "rationale_rule", "outcome", "condition", "consequence", "result", "mechanism", "span"]) {
      expect(row).not.toHaveProperty(k);
    }
    expect(Object.keys(row).slice(0, 2)).toEqual(["id", "iri"]);
  });

  it("claimBaseIri が http(s) でない・空白を含む場合はエラー", () => {
    for (const bad of ["foo", "ftp://x.org/", "https://a b/", "https://"]) {
      expect(buildAsterismBundle(items, { ...AST, claimBaseIri: bad }, o)).toEqual({ error: "claim-base-iri-required" });
    }
  });

  it("claimBaseIri の末尾スラッシュが無ければ補い、# 終わりはそのまま", () => {
    const iriOf = (b: string) => {
      const r = buildAsterismBundle(items, { ...AST, claimBaseIri: b }, o);
      if ("error" in r) throw new Error("unexpected");
      return (Object.values(r.files)[0][0] as { iri: string }).iri;
    };
    expect(iriOf("https://x.org/claim")).toMatch(/^https:\/\/x\.org\/claim\/[^/]+$/);
    expect(iriOf("https://x.org/v#")).toMatch(/^https:\/\/x\.org\/v#[^#]+$/);
  });

  it("claimBaseIri は末尾スラッシュ込みでそのまま連結、isWikiId で source_note から除く", () => {
    const b = ok(buildAsterismBundle(items, AST, { ...o, isWikiId: (i) => i === "w1" }));
    expect((b.files["judgments.json"][0] as { source_note: string[] }).source_note).toEqual(["n1"]);
  });

  it("evidence が全て無効でも列は省略せず []", () => {
    const m = base({ asterism: { typeSlug: "rule", evidenceIris: ["x", "mailto:a@b"] } });
    const b = ok(buildAsterismBundle([{ id: "r", meta: m }], AST, o));
    expect(b.files["rules.json"][0]).toHaveProperty("evidence", []);
  });

  it("全親ファイルの全行が同じキー集合・同じ順序（省略しない）", () => {
    const b = ok(buildAsterismBundle(items, AST, { ...o, includeUntyped: true, includeInferred: true }));
    const parents = ["judgments.json", "rules.json", "observations.json", "interpretations.json", "untyped.json"];
    for (const f of parents) expect(b.files[f]).toBeDefined();
    const keys = Object.keys(b.files["judgments.json"][0]);
    expect(keys).toEqual(PARENT_KEYS);
    for (const f of parents) for (const row of b.files[f]) expect(Object.keys(row)).toEqual(keys);
  });

  it("空の列: 配列は []、それ以外は null（untyped の type も null）", () => {
    const b = ok(buildAsterismBundle([{ id: "u", meta: { ...base({}), generatedAt: undefined } as unknown as WikiMeta }], AST, { ...o, includeUntyped: true }));
    expect(b.files["untyped.json"][0]).toEqual({
      id: "u",
      iri: CB + "u",
      type: null,
      type_term: null,
      title: "",
      statement_form: null,
      claim_role: [],
      epistemic_status: null,
      trigger_iri: [],
      action: null,
      rationale: null,
      rationale_rule_iri: [],
      outcome_iri: [],
      outcome_assessment: null,
      feature_of_interest: null,
      evidence: [],
      review_state: null,
      source_note: ["n1", "w1"],
      generated_at: null,
      exported_at: NOW,
    });
  });

  it("規則の子ファイル: role / position / 親 IRI、span と mechanism は出ない", () => {
    const m = base({
      asterism: { typeSlug: "rule" },
      ruleFrame: {
        conditions: [
          { item: "温度", itemIri: "quantitykind:Temperature", comparator: "gt", value: 80, unit: "degC", span: "SPAN-C" },
          { item: "圧力", span: "SPAN-C2" },
        ],
        consequences: [{ item: "収率", comparator: "decreases", span: "SPAN-D" }],
        mechanism: "MECH-TEXT",
        reviewState: "extracted",
      },
    });
    const b = ok(buildAsterismBundle([{ id: "r1", meta: m }], AST, o));
    expect(b.files["rule_terms.json"]).toEqual([
      { rule_id: "r1", rule_iri: CB + "r1", role: "condition", position: 0, item: "温度", item_iri: "http://qudt.org/vocab/quantitykind/Temperature", comparator: "gt", value_number: 80, value_text: null, unit: "degC" },
      { rule_id: "r1", rule_iri: CB + "r1", role: "condition", position: 1, item: "圧力", item_iri: null, comparator: null, value_number: null, value_text: null, unit: null },
      { rule_id: "r1", rule_iri: CB + "r1", role: "consequence", position: 0, item: "収率", item_iri: null, comparator: "decreases", value_number: null, value_text: null, unit: null },
    ]);
    // キー順序も固定
    expect(Object.keys(b.files["rule_terms.json"][1])).toEqual([
      "rule_id", "rule_iri", "role", "position", "item", "item_iri", "comparator", "value_number", "value_text", "unit",
    ]);
    const text = JSON.stringify(b.files);
    for (const w of ["MECH-TEXT", "SPAN-", "mechanism", "span"]) expect(text).not.toContain(w);
  });

  it("観察の子ファイル: observation_id / observation_iri / position、数字に見える文字列は value_text のまま、feature_of_interest は親", () => {
    const b = ok(buildAsterismBundle([{ id: "o1", meta: obs }], AST, o));
    expect(b.files["observation_terms.json"]).toEqual([
      { observation_id: "o1", observation_iri: CB + "o1", position: 0, item: "厚さ", item_iri: null, comparator: null, value_number: null, value_text: "12", unit: "um" },
    ]);
    expect(Object.keys(b.files["observation_terms.json"][0])).toEqual([
      "observation_id", "observation_iri", "position", "item", "item_iri", "comparator", "value_number", "value_text", "unit",
    ]);
    expect(b.files["observations.json"][0]).toMatchObject({ feature_of_interest: "試料A", review_state: "extracted" });
  });

  it("value は number なら value_number、string なら value_text、未定義・非有限は両方 null", () => {
    const m = base({
      asterism: { typeSlug: "rule" },
      ruleFrame: {
        conditions: [
          { item: "a", value: 4, span: "s" },
          { item: "b", value: "4", span: "s" },
          { item: "c", span: "s" },
          { item: "d", value: Number.NaN, span: "s" },
          { item: "e", value: 0, span: "s" },
        ],
        consequences: [],
        reviewState: "extracted",
      },
    });
    const b = ok(buildAsterismBundle([{ id: "r", meta: m }], AST, o));
    const pick = (b.files["rule_terms.json"] as { value_number: number | null; value_text: string | null }[]).map((r) => [r.value_number, r.value_text]);
    expect(pick).toEqual([[4, null], [null, "4"], [null, null], [null, null], [0, null]]);
    expect(b.files["rule_terms.json"][0]).not.toHaveProperty("value");
  });

  it("item_iri の未知 prefix の CURIE は原文のまま", () => {
    const m = base({
      asterism: { typeSlug: "rule" },
      ruleFrame: { conditions: [{ item: "x", itemIri: "foo:Bar", span: "s" }], consequences: [], reviewState: "extracted" },
    });
    const b = ok(buildAsterismBundle([{ id: "r", meta: m }], AST, o));
    expect((b.files["rule_terms.json"][0] as { item_iri: string }).item_iri).toBe("foo:Bar");
  });

  it("type は slug / CURIE / 完全 IRI を展開し、展開できなければ null で type_term に原文が残る", () => {
    const ast: AsterismSettings = {
      ...AST,
      typeSlugs: { judgment: "https://v.example/J", rule: "sv:rule", interpretation: "foo:bar", observation: "sosa:Observation" },
    };
    const mk = (t: string) => ({ id: t, meta: base({ asterism: { typeSlug: t } }) });
    const b = ok(buildAsterismBundle([mk("https://v.example/J"), mk("sv:rule"), mk("foo:bar"), mk("sosa:Observation")], ast, o));
    expect((b.files["judgments.json"][0] as { type: string }).type).toBe("https://v.example/J");
    expect((b.files["rules.json"][0] as { type: string }).type).toBe(BASE + "rule");
    expect(b.files["interpretations.json"][0]).toMatchObject({ type: null, type_term: "foo:bar" });
    expect((b.files["observations.json"][0] as { type: string }).type).toBe("http://www.w3.org/ns/sosa/Observation");
  });

  it("振り分けは設定の語との文字列比較（展開後ではない）", () => {
    // 設定が sv:rule のとき、slug の rule は一致しない
    const ast: AsterismSettings = { ...AST, typeSlugs: { ...AST.typeSlugs, rule: "sv:rule" } };
    const b = ok(buildAsterismBundle([{ id: "r", meta: base({ asterism: { typeSlug: "rule" } }) }], ast, o));
    expect(b.skipped).toEqual([{ id: "r", reason: "unknown-type" }]);
  });

  it("同じ語が複数の型にあれば judgment → rule → interpretation → observation の先勝ち", () => {
    const ast: AsterismSettings = { ...AST, typeSlugs: { judgment: "", rule: "same", interpretation: "same", observation: "same" } };
    const b = ok(buildAsterismBundle([{ id: "a", meta: base({ asterism: { typeSlug: "same" } }) }], ast, o));
    expect(Object.keys(b.files)).toEqual(["rules.json"]);
    const ast2: AsterismSettings = { ...AST, typeSlugs: { judgment: "same", rule: "same", interpretation: "", observation: "" } };
    expect(Object.keys(ok(buildAsterismBundle([{ id: "a", meta: base({ asterism: { typeSlug: "same" } }) }], ast2, o)).files)).toEqual(["judgments.json"]);
  });

  it("設定の語が空の型には振り分けない", () => {
    const ast: AsterismSettings = { ...AST, typeSlugs: { judgment: "", rule: "", interpretation: "", observation: "" } };
    const b = ok(buildAsterismBundle([{ id: "a", meta: base({ asterism: { typeSlug: "rule" } }) }], ast, o));
    expect(b.skipped).toEqual([{ id: "a", reason: "unknown-type" }]);
  });
});

describe("serializeAsterismBundle", () => {
  it("ファイルごとに 2 スペースインデントの JSON 配列", () => {
    const b = ok(buildAsterismBundle(items, AST, o));
    const out = serializeAsterismBundle(b.files);
    expect(Object.keys(out)).toEqual(Object.keys(b.files));
    expect(out["judgments.json"].startsWith('[\n  {\n    "id": "d"')).toBe(true);
    for (const [name, text] of Object.entries(out)) expect(JSON.parse(text)).toEqual(b.files[name]);
  });
});
