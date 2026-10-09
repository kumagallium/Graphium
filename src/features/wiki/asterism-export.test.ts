import { describe, it, expect } from "vitest";
import type { WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import {
  expandVocabTerm,
  toAsterismRow,
  buildAsterismExport,
  serializeAsterismExport,
} from "./asterism-export";

const BASE = "https://vocab.example/shared#";
const AST: AsterismSettings = {
  vocabBaseIri: BASE,
  claimBaseIri: "",
  typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
};
const NOW = "2026-10-09T00:00:00.000Z";

const base = (o: Partial<WikiMeta>): WikiMeta =>
  ({ kind: "claim", derivedFromNotes: ["n1", "w1"], derivedFromChats: [], generatedAt: "2026-01-01T00:00:00Z", ...o }) as WikiMeta;

const decision = base({
  claimRole: ["decision"],
  statementForm: "instance",
  asterism: { typeSlug: "judgment", evidenceIris: ["https://e.example/1"] },
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
    reviewState: "inferred",
  },
});

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

describe("toAsterismRow", () => {
  it("claim 以外は null", () => {
    expect(toAsterismRow("x", base({ kind: "topic" }), AST, NOW)).toBeNull();
  });
  it("判断の行", () => {
    const r = toAsterismRow("d1", decision, AST, NOW, { title: "T", isWikiId: (i) => i === "w1" })!;
    expect(r).toMatchObject({
      id: "d1",
      type: BASE + "judgment",
      type_term: "judgment",
      title: "T",
      statement_form: "instance",
      claim_role: ["decision"],
      trigger: ["t1"],
      action: "乾燥時間を延ばす",
      rationale: "割れを避けるため",
      rationale_rule: ["r1"],
      outcome: ["o1"],
      outcome_assessment: "confirmed",
      evidence: ["https://e.example/1"],
      review_state: "confirmed",
      source_note: ["n1"],
      generated_at: "2026-01-01T00:00:00Z",
      exported_at: NOW,
    });
  });
  it("規則の行: 値は number のまま、span と mechanism は出ない", () => {
    const r = toAsterismRow("r1", rule, AST, NOW)!;
    expect(r.condition).toEqual([
      { item: "温度", item_iri: "http://qudt.org/vocab/quantitykind/Temperature", comparator: "gt", value: 80, unit: "degC" },
    ]);
    expect(r.consequence).toEqual([{ item: "収率", comparator: "decreases" }]);
    const text = JSON.stringify(r);
    expect(text).not.toContain("MECH-TEXT");
    expect(text).not.toContain("SPAN-");
    expect(text).not.toContain("mechanism");
    expect(text).not.toContain("span");
  });
  it("観察の行: CURIE を展開、value は string のまま", () => {
    const r = toAsterismRow("o1", obs, AST, NOW)!;
    expect(r.type).toBe("http://www.w3.org/ns/sosa/Observation");
    expect(r.feature_of_interest).toBe("試料A");
    expect(r.result).toEqual([{ item: "厚さ", value: "12", unit: "um" }]);
    expect(r.review_state).toBe("inferred");
  });
  it("未知 prefix は type: null で type_term に原文が残る", () => {
    const r = toAsterismRow("x", base({ asterism: { typeSlug: "foo:bar" } }), AST, NOW)!;
    expect(r.type).toBeNull();
    expect(r.type_term).toBe("foo:bar");
  });
  it("review_state は 3 frame の最低状態", () => {
    const m = base({
      decisionFrame: { triggerClaimIds: [], action: "a", rationale: null, reviewState: "confirmed" },
      ruleFrame: { conditions: [], consequences: [], reviewState: "extracted" },
    });
    expect(toAsterismRow("x", m, AST, NOW)!.review_state).toBe("extracted");
  });
  it("claimBaseIri があるときだけ iri 列", () => {
    expect(toAsterismRow("a", decision, AST, NOW)!).not.toHaveProperty("iri");
    const r = toAsterismRow("a", decision, { ...AST, claimBaseIri: "https://ex.example/c/" }, NOW)!;
    expect(r.iri).toBe("https://ex.example/c/a");
    expect(Object.keys(r).slice(0, 2)).toEqual(["id", "iri"]);
  });
  it("exported_at は渡した値そのまま", () => {
    expect(toAsterismRow("a", decision, AST, "custom")!.exported_at).toBe("custom");
  });
});

describe("buildAsterismExport", () => {
  const items = [
    { id: "d", meta: decision },
    { id: "r", meta: rule },
    { id: "o", meta: obs },
    { id: "u", meta: base({}) },
    { id: "t", meta: base({ kind: "topic" }) },
  ];
  const o = { includeUntyped: false, includeInferred: false, exportedAt: NOW };

  it("既定は型付きかつ inferred 以外のみ。除外理由 3 種", () => {
    const { rows, skipped } = buildAsterismExport(items, AST, o);
    expect(rows.map((r) => r.id)).toEqual(["d", "r"]);
    expect(skipped).toEqual([
      { id: "o", reason: "inferred" },
      { id: "u", reason: "untyped" },
      { id: "t", reason: "not-claim" },
    ]);
  });
  it("includeUntyped / includeInferred で含まれる", () => {
    const { rows } = buildAsterismExport(items, AST, { ...o, includeUntyped: true, includeInferred: true });
    expect(rows.map((r) => r.id)).toEqual(["d", "r", "o", "u"]);
    expect(rows.find((r) => r.id === "u")!.type).toBeNull();
  });
  it("includeInferred だけ true なら型なしは依然除外", () => {
    const { rows } = buildAsterismExport(items, AST, { ...o, includeInferred: true });
    expect(rows.map((r) => r.id)).toEqual(["d", "r", "o"]);
  });
});

describe("serializeAsterismExport", () => {
  it("2 スペースインデントの JSON 配列", () => {
    const rows = buildAsterismExport([{ id: "d", meta: decision }], AST, {
      includeUntyped: false,
      includeInferred: false,
      exportedAt: NOW,
    }).rows;
    const text = serializeAsterismExport(rows);
    expect(text.startsWith('[\n  {\n    "id": "d"')).toBe(true);
    expect(JSON.parse(text)).toEqual(rows);
  });
  it("item_iri の CURIE は完全 IRI に展開し、未知 prefix は原文のまま", () => {
    const m = {
      kind: "claim",
      ruleFrame: {
        conditions: [
          { item: "時間", itemIri: "quantitykind:Time", span: "s" },
          { item: "x", itemIri: "foo:Bar", span: "s" },
        ],
        consequences: [],
        reviewState: "extracted",
      },
    } as unknown as WikiMeta;
    const r = toAsterismRow("c1", m, AST, NOW)!;
    expect(r.condition?.map((c) => c.item_iri)).toEqual(["http://qudt.org/vocab/quantitykind/Time", "foo:Bar"]);
  });
});
