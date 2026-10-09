import { describe, expect, it } from "vitest";
import { buildWikiDocument, frameFieldsFromIngest } from "./wiki-service";
import type { IngesterOutput } from "../../server/services/wiki-ingester";

const claim = (p: Partial<IngesterOutput> = {}): IngesterOutput =>
  ({
    kind: "claim",
    title: "T",
    sections: [{ heading: "本文", content: "x" }],
    suggestedAction: "create",
    confidence: 0.9,
    relatedClaims: [],
    externalReferences: [],
    ...p,
  }) as IngesterOutput;

const fv = (item: string) => ({ item, span: item }) as never;

describe("frameFieldsFromIngest", () => {
  it("claim 以外は空", () => {
    expect(frameFieldsFromIngest(claim({ kind: "atom" as never }))).toEqual({});
  });

  it("triggerTitles を転記せず、ids は [] で reviewState は extracted", () => {
    const f = frameFieldsFromIngest(
      claim({
        statementForm: "general",
        decisionFrame: { triggerTitles: ["A"], action: "act", rationale: "r", rationaleRuleTitles: ["B"] },
        ruleFrame: { conditions: [fv("c")], consequences: [fv("q")], mechanism: "m" },
        observationFrame: { featureOfInterest: "f", results: [] },
      } as Partial<IngesterOutput>),
    );
    expect(f.statementForm).toBe("general");
    expect(f.decisionFrame).toEqual({
      triggerClaimIds: [],
      action: "act",
      rationale: "r",
      rationaleRuleIds: [],
      reviewState: "extracted",
    });
    expect(JSON.stringify(f)).not.toContain("triggerTitles");
    expect(f.ruleFrame?.reviewState).toBe("extracted");
    expect(f.observationFrame?.reviewState).toBe("extracted");
  });

  it("frame が無ければ undefined", () => {
    const f = frameFieldsFromIngest(claim());
    expect(f.decisionFrame).toBeUndefined();
    expect(f.ruleFrame).toBeUndefined();
    expect(f.observationFrame).toBeUndefined();
  });
});

describe("buildWikiDocument - frame", () => {
  it("frame 付き IngesterOutput が wikiMeta に乗る", () => {
    const doc = buildWikiDocument(
      claim({
        statementForm: "general",
        ruleFrame: { conditions: [fv("c")], consequences: [fv("q")] },
      } as Partial<IngesterOutput>),
      "src",
      null,
    )!;
    expect(doc.wikiMeta?.statementForm).toBe("general");
    expect(doc.wikiMeta?.ruleFrame?.conditions).toEqual([fv("c")]);
    expect(doc.wikiMeta?.ruleFrame?.reviewState).toBe("extracted");
  });
});

describe("buildWikiDocument - asterism", () => {
  const set = { vocabBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "rule", judgment: "" } };
  const empty = { vocabBaseIri: "", typeSlugs: { observation: "", interpretation: "", rule: "", judgment: "" } };
  const build = (a: typeof set) =>
    buildWikiDocument(claim({ statementForm: "general" } as Partial<IngesterOutput>), "n1", "m", "N", undefined, "ja", undefined, undefined, a);
  it("設定があれば typeSlug が付く", () => {
    expect(build(set)?.wikiMeta?.asterism).toEqual({ typeSlug: "rule", typeSlugBy: "auto" });
  });
  it("全て空なら付かない", () => {
    expect(build(empty)?.wikiMeta?.asterism).toBeUndefined();
  });
});
