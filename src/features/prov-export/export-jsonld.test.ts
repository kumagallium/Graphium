// Phase 4 (PR-B7): PROV-JSON-LD エクスポートに Wiki Knowledge Layer の
// 意味的な型を持ち出せていることを検証する。
//
// 検証ポイント:
// - kind ごとに該当する型だけが emit される（atom → atomType, synthesis → synthesisMode）
// - Claim の procedureContext がそのまま @graph に乗る
// - 値が未指定のフィールドは出力に含まれない

import { describe, it, expect } from "vitest";
import { buildW3CProvJsonLd, type WikiEntityInfo } from "./export-jsonld";
import type { ProvJsonLd } from "../prov-generator";

const emptyProv: ProvJsonLd = {
  "@context": {
    "@version": 1.1,
    prov: "http://www.w3.org/ns/prov#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    graphium: "https://graphium.app/ns#",
  } as any,
  "@graph": [],
};

function findWikiNode(graph: any[], title: string) {
  return graph.find(
    (n) => n["@type"] === "Entity" && n["@id"] === `graphium:wiki/${encodeURIComponent(title)}`,
  );
}

describe("buildW3CProvJsonLd — Wiki Knowledge Layer fields (Phase 4)", () => {
  it("emits no wiki node when wikiEntities is omitted", () => {
    const doc = buildW3CProvJsonLd(emptyProv, "note-title");
    const wikiNode = doc["@graph"].find((n: any) => n["@type"] === "Entity" && /^graphium:wiki\//.test(n["@id"]));
    expect(wikiNode).toBeUndefined();
  });

  it("emits atomType on an Insights (atom) wiki entity, and no synthesisMode", () => {
    const wiki: WikiEntityInfo = {
      title: "Causal link between T and Y",
      kind: "atom",
      status: "active",
      generatedAt: "2026-05-10T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: [],
      atomType: "causal",
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const node = findWikiNode(doc["@graph"], wiki.title);
    expect(node).toBeDefined();
    expect(node!["graphium:wikiKind"]).toBe("atom");
    expect(node!["graphium:atomType"]).toBe("causal");
    expect(node!["graphium:synthesisMode"]).toBeUndefined();
    expect(node!["graphium:procedureContext"]).toBeUndefined();
  });

  it("emits synthesisMode + hypothesisStatus on an Ideas (synthesis) wiki entity", () => {
    const wiki: WikiEntityInfo = {
      title: "Bridging T and pH effects",
      kind: "synthesis",
      status: "active",
      generatedAt: "2026-05-10T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: [],
      synthesisMode: "abductive",
      hypothesisStatus: "speculative",
      confidence: 0.91,
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const node = findWikiNode(doc["@graph"], wiki.title);
    expect(node).toBeDefined();
    expect(node!["graphium:synthesisMode"]).toBe("abductive");
    expect(node!["graphium:hypothesisStatus"]).toBe("speculative");
    expect(node!["graphium:confidence"]).toBe(0.91);
    expect(node!["graphium:atomType"]).toBeUndefined();
  });

  it("emits procedureContext on a Claim wiki entity (reproducibility scaffold)", () => {
    const wiki: WikiEntityInfo = {
      title: "Annealed thin film resists oxidation",
      kind: "claim",
      status: "active",
      generatedAt: "2026-05-10T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: ["note-a"],
      claimRole: ["finding"],
      level: "finding",
      procedureContext: {
        derivedFromNotes: ["note-a"],
        protocolFingerprint: "spin-coat → anneal",
        keyParameters: [
          { name: "T_anneal", value: "650°C", necessity: "critical" },
        ],
        keyTools: ["RTA furnace"],
        validityRange: "T_anneal ∈ [600, 700]°C",
      },
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const node = findWikiNode(doc["@graph"], wiki.title);
    expect(node).toBeDefined();
    expect(node!["graphium:claimRole"]).toEqual(["finding"]);
    expect(node!["graphium:claimLevel"]).toBe("finding");
    expect(node!["graphium:procedureContext"]).toEqual(wiki.procedureContext);
  });

  it("does not emit graphium:claimRole when claimRole is an empty array", () => {
    const wiki: WikiEntityInfo = {
      title: "x",
      kind: "claim",
      status: "active",
      generatedAt: "2026-05-10T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
      claimRole: [],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const node = findWikiNode(doc["@graph"], wiki.title);
    expect(node!["graphium:claimRole"]).toBeUndefined();
  });

  it("still emits Derivation and Attribution relations alongside the new fields", () => {
    const wiki: WikiEntityInfo = {
      title: "x",
      kind: "atom",
      status: "active",
      generatedAt: "2026-05-10T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: ["note-a"],
      atomType: "mechanistic",
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const types = doc["@graph"].map((n: any) => n["@type"]);
    expect(types).toContain("Derivation");
    expect(types).toContain("Attribution");
  });
});
