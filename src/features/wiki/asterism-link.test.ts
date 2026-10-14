import { describe, expect, it } from "vitest";
import type { WikiMeta } from "../../lib/document-types";
import type { AsterismSettings } from "../settings/store";
import {
  applyAsterismDefaults,
  classifyVocabTerm,
  hasAsterismTerms,
  normalizeEvidenceIris,
  resolveAsterismTypeSlug,
} from "./asterism-link";

const EMPTY: AsterismSettings = {
  vocabBaseIri: "",
  typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" },
};
const SET: AsterismSettings = {
  vocabBaseIri: "",
  typeSlugs: { observation: "sosa:Observation", interpretation: "interp", rule: "rule", judgment: "judg" },
};
const meta = (p: Partial<WikiMeta> = {}): WikiMeta =>
  ({ kind: "claim", derivedFromNotes: [], derivedFromChats: [], generatedAt: "", generatedBy: { model: "m", version: "1" }, lastIngestedAt: "", ...p }) as WikiMeta;

describe("classifyVocabTerm", () => {
  it("4 分類", () => {
    expect(classifyVocabTerm("")).toBe("empty");
    expect(classifyVocabTerm("  ")).toBe("empty");
    expect(classifyVocabTerm("https://a.b/c#d")).toBe("iri");
    expect(classifyVocabTerm("sosa:Observation")).toBe("curie");
    expect(classifyVocabTerm("rule")).toBe("slug");
    expect(classifyVocabTerm("規則")).toBe("empty");
    expect(classifyVocabTerm("a b")).toBe("empty");
  });
});

describe("resolveAsterismTypeSlug", () => {
  it("判定順 5 行", () => {
    expect(resolveAsterismTypeSlug(meta({ claimRole: ["decision"], statementForm: "general" }), SET)).toBe("judg");
    expect(resolveAsterismTypeSlug(meta({ statementForm: "general", epistemicStatus: "interpretation" }), SET)).toBe("rule");
    expect(resolveAsterismTypeSlug(meta({ claimRole: ["interpretation"] }), SET)).toBe("interp");
    expect(resolveAsterismTypeSlug(meta({ epistemicStatus: "speculation" }), SET)).toBe("interp");
    expect(resolveAsterismTypeSlug(meta({ statementForm: "instance", epistemicStatus: "observation" }), SET)).toBe("sosa:Observation");
    expect(resolveAsterismTypeSlug(meta({ statementForm: "instance" }), SET)).toBeUndefined();
  });
  it("該当語が空なら undefined（次の行に落ちない）", () => {
    const s = { ...SET, typeSlugs: { ...SET.typeSlugs, judgment: "" } };
    expect(resolveAsterismTypeSlug(meta({ claimRole: ["decision"], statementForm: "general" }), s)).toBeUndefined();
  });
  it("設定が全て空なら undefined", () => {
    expect(resolveAsterismTypeSlug(meta({ statementForm: "general" }), EMPTY)).toBeUndefined();
  });
});

describe("applyAsterismDefaults", () => {
  it("auto を付ける", () => {
    expect(applyAsterismDefaults(meta({ statementForm: "general" }), SET).asterism).toEqual({ typeSlug: "rule", typeSlugBy: "auto" });
  });
  it("human は触らない", () => {
    const m = meta({ statementForm: "general", asterism: { typeSlug: "x", typeSlugBy: "human" } });
    expect(applyAsterismDefaults(m, SET)).toBe(m);
  });
  it("human の「付けない」（typeSlug 無し）も触らない", () => {
    const m = meta({ statementForm: "general", asterism: { typeSlugBy: "human" } });
    expect(applyAsterismDefaults(m, SET)).toBe(m);
  });
  it("auto は再計算し evidenceIris を保持", () => {
    const m = meta({ statementForm: "general", asterism: { typeSlug: "old", typeSlugBy: "auto", evidenceIris: ["http://e/1"] } });
    expect(applyAsterismDefaults(m, SET).asterism).toEqual({ typeSlug: "rule", typeSlugBy: "auto", evidenceIris: ["http://e/1"] });
  });
  it("全て空で証拠も無ければ asterism を消す", () => {
    const m = meta({ statementForm: "general", asterism: { typeSlug: "old", typeSlugBy: "auto" } });
    expect("asterism" in applyAsterismDefaults(m, EMPTY)).toBe(false);
  });
  it("全て空でも evidenceIris があれば残す", () => {
    const m = meta({ asterism: { typeSlug: "old", evidenceIris: ["http://e/1"] } });
    expect(applyAsterismDefaults(m, EMPTY).asterism).toEqual({ evidenceIris: ["http://e/1"] });
  });
  it("claim 以外は無変更", () => {
    const m = meta({ kind: "atom" as never, statementForm: "general" });
    expect(applyAsterismDefaults(m, SET)).toBe(m);
  });
});

describe("normalizeEvidenceIris", () => {
  it("trim・空行除去・重複除去・不正行は件数", () => {
    const r = normalizeEvidenceIris(" http://a/1 \n\nhttp://a/1\nex:foo\nbad line\nnocolon");
    expect(r.iris).toEqual(["http://a/1", "ex:foo"]);
    expect(r.rejected).toBe(2);
  });
});

describe("hasAsterismTerms", () => {
  const empty = { vocabBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" } };
  it("全て空なら false、1 つでも使える語があれば true、不正な語だけなら false", () => {
    expect(hasAsterismTerms(empty)).toBe(false);
    expect(hasAsterismTerms({ ...empty, typeSlugs: { ...empty.typeSlugs, rule: "rule" } })).toBe(true);
    expect(hasAsterismTerms({ ...empty, typeSlugs: { ...empty.typeSlugs, rule: "日本語" } })).toBe(false);
  });
});
