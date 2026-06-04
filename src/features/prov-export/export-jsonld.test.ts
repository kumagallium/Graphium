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

  it("emits a Derivation edge for each citedKnowledgeIds entry (R2 verb intake / PR4 L2)", () => {
    const wiki: WikiEntityInfo = {
      title: "Contradiction between A and B",
      kind: "claim",
      status: "candidate",
      generatedAt: "2026-06-01T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: ["src-note"],
      citedKnowledgeIds: ["claim-x", "atom-y"],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const derivations = doc["@graph"].filter(
      (n: any) => n["@type"] === "Derivation" &&
        n.generatedEntity === `graphium:wiki/${encodeURIComponent(wiki.title)}`,
    );
    const used = derivations.map((d: any) => d.usedEntity).sort();
    // 発火元ノート + 引用 2 件 = 3 本の Derivation
    expect(used).toEqual([
      "graphium:note/atom-y",
      "graphium:note/claim-x",
      "graphium:note/src-note",
    ]);
  });

  it("emits no cited Derivation when citedKnowledgeIds is omitted", () => {
    const wiki: WikiEntityInfo = {
      title: "x",
      kind: "claim",
      status: "active",
      generatedAt: "2026-06-01T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const cited = doc["@graph"].filter((n: any) =>
      typeof n["@id"] === "string" && n["@id"].includes("wiki_cited_"),
    );
    expect(cited).toHaveLength(0);
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

// PROV-DM 準拠監査（2026-06）で確定した修正を invariant として固定する。
describe("buildW3CProvJsonLd — PROV-DM compliance fixes", () => {
  it("resolves external-source prefixes (document:/pdf:/url:/chat:) instead of graphium:note/<prefixed> (H2)", () => {
    const wiki: WikiEntityInfo = {
      title: "From a Word doc",
      kind: "claim",
      status: "active",
      generatedAt: "2026-06-05T00:00:00Z",
      model: "m",
      derivedFromNotes: ["document:file-123", "plain-note"],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const used = doc["@graph"]
      .filter((n: any) => n["@type"] === "Derivation")
      .map((d: any) => d.usedEntity)
      .sort();
    expect(used).toEqual(["graphium:document/file-123", "graphium:note/plain-note"]);
    // 不正参照 graphium:note/document:... を生まない
    expect(used).not.toContain("graphium:note/document:file-123");
    // 外部ソースは型付き Entity ノードとして宣言される
    const ext = doc["@graph"].find((n: any) => n["@id"] === "graphium:document/file-123");
    expect(ext).toMatchObject({ "@type": "Entity", "graphium:sourceKind": "document" });
  });

  it("declares a prov:Agent node for every wiki Attribution agent — no dangling agent (M2)", () => {
    const wiki: WikiEntityInfo = {
      title: "x",
      kind: "atom",
      status: "active",
      generatedAt: "2026-06-05T00:00:00Z",
      model: "claude-sonnet",
      derivedFromNotes: [],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const attr = doc["@graph"].find((n: any) => n["@type"] === "Attribution");
    expect(attr).toBeDefined();
    const agentNode = doc["@graph"].find(
      (n: any) => n["@type"] === "Agent" && n["@id"] === attr!.agent,
    );
    expect(agentNode).toBeDefined();
    expect(agentNode!["graphium:agentType"]).toBe("ai");
  });

  it("declares an Entity node for every Derivation usedEntity — no dangling note refs (M3)", () => {
    const wiki: WikiEntityInfo = {
      title: "x",
      kind: "claim",
      status: "active",
      generatedAt: "2026-06-05T00:00:00Z",
      model: "m",
      derivedFromNotes: ["note-a"],
      citedKnowledgeIds: ["claim-b"],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const derivs = doc["@graph"].filter((n: any) => n["@type"] === "Derivation");
    expect(derivs.length).toBeGreaterThan(0);
    for (const d of derivs) {
      const decl = doc["@graph"].find(
        (n: any) => n["@id"] === d.usedEntity && n["@type"] === "Entity",
      );
      expect(decl, `usedEntity ${d.usedEntity} should be declared as an Entity`).toBeDefined();
    }
  });

  it("emits a Derivation for each derivedFromClaims entry — atomize lane (M4)", () => {
    const wiki: WikiEntityInfo = {
      title: "atom-1",
      kind: "atom",
      status: "active",
      generatedAt: "2026-06-05T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
      derivedFromClaims: ["claim-1", "claim-2"],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const used = doc["@graph"]
      .filter((n: any) => n["@type"] === "Derivation")
      .map((d: any) => d.usedEntity)
      .sort();
    expect(used).toEqual(["graphium:note/claim-1", "graphium:note/claim-2"]);
  });

  it("types the document-provenance container as prov:Bundle, with correct Association/Generation slots (M1, T2)", () => {
    const provWithBundle: ProvJsonLd = {
      ...emptyProv,
      "graphium:documentProvenance": {
        "@type": "prov:Bundle",
        "@graph": [
          { "@id": "agent_h", "@type": "prov:Agent", "rdfs:label": "Author", "graphium:agentType": "human" },
          {
            "@id": "edit_1",
            "@type": "prov:Activity",
            "graphium:editType": "edit",
            "prov:startedAtTime": "2026-06-05T00:00:00Z",
            "prov:endedAtTime": "2026-06-05T00:01:00Z",
            "prov:wasAssociatedWith": { "@id": "agent_h" },
          },
          {
            "@id": "rev_1",
            "@type": "prov:Entity",
            "prov:generatedAtTime": "2026-06-05T00:01:00Z",
            "prov:wasGeneratedBy": { "@id": "edit_1" },
            "graphium:contentHash": "abc",
          },
        ],
      } as any,
    };
    const doc = buildW3CProvJsonLd(provWithBundle, "my note");
    const bundle = doc["@graph"].find((n: any) => n["@type"] === "prov:Bundle");
    expect(bundle).toBeDefined();
    const inner = bundle!["@graph"];
    expect(inner.find((n: any) => n["@type"] === "Association")).toMatchObject({
      activity: "edit_1",
      agent: "agent_h",
    });
    expect(inner.find((n: any) => n["@type"] === "Generation")).toMatchObject({
      entity: "rev_1",
      activity: "edit_1",
    });
  });

  it("reifies content-provenance Usage/Generation with correct activity/entity slots (T1)", () => {
    const provDoc: ProvJsonLd = {
      ...emptyProv,
      "@graph": [
        { "@id": "activity_a", "@type": "prov:Activity", "rdfs:label": "Step", "graphium:blockId": "a", "prov:used": [{ "@id": "entity_m" }] },
        { "@id": "entity_m", "@type": "prov:Entity", "rdfs:label": "Cu", "graphium:blockId": "m" },
        { "@id": "result_o", "@type": "prov:Entity", "rdfs:label": "Out", "graphium:blockId": "o", "prov:wasGeneratedBy": [{ "@id": "activity_a" }] },
      ] as any,
    };
    const doc = buildW3CProvJsonLd(provDoc, "n");
    expect(doc["@graph"].find((n: any) => n["@type"] === "Usage")).toMatchObject({
      activity: "activity_a",
      entity: "entity_m",
    });
    expect(doc["@graph"].find((n: any) => n["@type"] === "Generation")).toMatchObject({
      entity: "result_o",
      activity: "activity_a",
    });
  });

  it("emits one Generation per generating activity when an entity has multiple (H1)", () => {
    const provDoc: ProvJsonLd = {
      ...emptyProv,
      "@graph": [
        {
          "@id": "shared_out",
          "@type": "prov:Entity",
          "rdfs:label": "Shared",
          "graphium:blockId": "o",
          "prov:wasGeneratedBy": [{ "@id": "activity_a" }, { "@id": "activity_b" }],
        },
      ] as any,
    };
    const doc = buildW3CProvJsonLd(provDoc, "n");
    const acts = doc["@graph"]
      .filter((n: any) => n["@type"] === "Generation" && n.entity === "shared_out")
      .map((g: any) => g.activity)
      .sort();
    expect(acts).toEqual(["activity_a", "activity_b"]);
  });
});
