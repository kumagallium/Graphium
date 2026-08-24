// Phase 4 (PR-B7): PROV-JSON-LD エクスポートに Wiki Knowledge Layer の
// 意味的な型を持ち出せていることを検証する。
//
// 検証ポイント:
// - kind ごとに該当する型だけが emit される（atom → atomType, synthesis → synthesisMode）
// - Claim の procedureContext がそのまま @graph に乗る
// - 値が未指定のフィールドは出力に含まれない

import { describe, it, expect } from "vitest";
import { buildW3CProvJsonLd, type WikiEntityInfo } from "./export-jsonld";
import { generateProvDocument, type ProvJsonLd } from "../prov-generator";
import type { BlockLink } from "../block-link/link-types";

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
    // Bundle 内の相対 ID（rev_*/edit_*/agent_*）は Bundle @id でスコープ化される
    // （複数 Bundle 同居時の IRI 衝突防止）
    const scope = bundle!["@id"];
    expect(scope).toBe(`graphium:documentProvenance/${encodeURIComponent("my note")}`);
    const inner = bundle!["@graph"];
    expect(inner.find((n: any) => n["@type"] === "Association")).toMatchObject({
      activity: `${scope}/edit_1`,
      agent: `${scope}/agent_h`,
    });
    expect(inner.find((n: any) => n["@type"] === "Generation")).toMatchObject({
      entity: `${scope}/rev_1`,
      activity: `${scope}/edit_1`,
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

  it("reifies bundle Activity prov:used as Usage relations with declared source stubs", () => {
    const provWithUsed: ProvJsonLd = {
      ...emptyProv,
      "graphium:documentProvenance": {
        "@type": "prov:Bundle",
        "@graph": [
          { "@id": "agent_ai", "@type": "prov:Agent", "rdfs:label": "m", "graphium:agentType": "ai" },
          {
            "@id": "edit_1",
            "@type": "prov:Activity",
            "graphium:editType": "wiki_merge",
            "prov:startedAtTime": "2026-07-01T00:00:00Z",
            "prov:endedAtTime": "2026-07-01T00:00:00Z",
            "prov:wasAssociatedWith": { "@id": "agent_ai" },
            "prov:used": [{ "@id": "note-a" }, { "@id": "pdf:file-9" }],
          },
        ],
      } as any,
    };
    const doc = buildW3CProvJsonLd(provWithUsed, "n");
    const bundle = doc["@graph"].find((n: any) => n["@type"] === "prov:Bundle");
    const scope = bundle!["@id"];
    const inner = bundle!["@graph"];
    const usages = inner.filter(
      (n: any) => n["@type"] === "Usage" && n.activity === `${scope}/edit_1`,
    );
    const usedEntities = usages.map((u: any) => u.entity).sort();
    // 素のノート ID と外部ソース prefix の両方が型付き @id に解決される
    expect(usedEntities).toEqual(["graphium:note/note-a", "graphium:pdf/file-9"]);
    // 参照先は Bundle 内に Entity として宣言される（dangling 防止）
    for (const id of usedEntities) {
      const decl = inner.find((n: any) => n["@id"] === id && n["@type"] === "Entity");
      expect(decl, `used source ${id} should be declared`).toBeDefined();
    }
  });

  it("emits a Derivation for each derivedFromChats entry (chat lane)", () => {
    const wiki: WikiEntityInfo = {
      title: "from-chat",
      kind: "claim",
      status: "active",
      generatedAt: "2026-07-01T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
      derivedFromChats: ["chat:abc"],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const used = doc["@graph"]
      .filter((n: any) => n["@type"] === "Derivation")
      .map((d: any) => d.usedEntity);
    expect(used).toEqual(["graphium:chat/abc"]);
  });

  it("attaches a per-wiki provenance Bundle (growth history) with contentDiff stripped", () => {
    const wiki: WikiEntityInfo = {
      id: "wiki-file-1",
      title: "growing-claim",
      kind: "claim",
      status: "active",
      generatedAt: "2026-07-01T00:00:00Z",
      model: "m",
      derivedFromNotes: ["note-a"],
      documentProvenance: {
        agents: [{ id: "agent_ai_m", type: "ai", label: "m" }],
        activities: [
          {
            id: "edit_001",
            type: "wiki_ingest",
            startedAt: "2026-07-01T00:00:00Z",
            endedAt: "2026-07-01T00:00:00Z",
            wasAssociatedWith: "agent_ai_m",
            used: ["note-a"],
          },
          {
            id: "edit_002",
            type: "wiki_merge",
            startedAt: "2026-07-02T00:00:00Z",
            endedAt: "2026-07-02T00:00:00Z",
            wasAssociatedWith: "agent_ai_m",
            used: ["note-b"],
          },
        ],
        revisions: [
          {
            id: "rev_001",
            savedAt: "2026-07-01T00:00:00Z",
            summary: {
              blocksAdded: 3, blocksRemoved: 0, blocksModified: 0,
              labelsChanged: [], provLinksAdded: 0, provLinksRemoved: 0,
              knowledgeLinksAdded: 0, knowledgeLinksRemoved: 0,
              contentDiff: [{ blockId: "b1", type: "add", after: "secret body text" }],
            },
            contentHash: "h1",
            wasGeneratedBy: "edit_001",
          },
          {
            id: "rev_002",
            savedAt: "2026-07-02T00:00:00Z",
            summary: {
              blocksAdded: 0, blocksRemoved: 0, blocksModified: 2,
              labelsChanged: [], provLinksAdded: 0, provLinksRemoved: 0,
              knowledgeLinksAdded: 0, knowledgeLinksRemoved: 0,
            },
            contentHash: "h2",
            prevContentHash: "h1",
            wasDerivedFrom: "rev_001",
            wasGeneratedBy: "edit_002",
          },
        ],
      },
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);

    // wiki ノードが Bundle への node reference（@id オブジェクト）を持ち、
    // Bundle @id は同名タイトル衝突を避けるため内部 wiki ID キー
    const wikiNode = findWikiNode(doc["@graph"], wiki.title);
    expect(wikiNode!["graphium:noteId"]).toBe("wiki-file-1");
    const bundleRef = wikiNode!["graphium:provenanceBundle"];
    const bundleId = `graphium:documentProvenance/wiki/${encodeURIComponent(wiki.id!)}`;
    expect(bundleRef).toEqual({ "@id": bundleId });
    const bundle = doc["@graph"].find(
      (n: any) => n["@type"] === "prov:Bundle" && n["@id"] === bundleId,
    );
    expect(bundle).toBeDefined();
    const inner = bundle!["@graph"];

    // 成長系譜: 型付き Activity・リビジョン連鎖・取り込みソースが全て残る
    // （rev_*/edit_* は Bundle @id でスコープ化される）
    const acts = inner.filter((n: any) => n["@type"] === "Activity");
    expect(acts.map((a: any) => a["graphium:editType"]).sort()).toEqual([
      "wiki_ingest",
      "wiki_merge",
    ]);
    const deriv = inner.find((n: any) => n["@type"] === "Derivation");
    expect(deriv).toMatchObject({
      generatedEntity: `${bundleId}/rev_002`,
      usedEntity: `${bundleId}/rev_001`,
    });
    const usages = inner.filter((n: any) => n["@type"] === "Usage");
    // 取り込みソースは Bundle 外の実体なのでスコープ化されない
    expect(usages.map((u: any) => u.entity).sort()).toEqual([
      "graphium:note/note-a",
      "graphium:note/note-b",
    ]);

    // contentDiff（本文差分）は export に同梱しない
    expect(JSON.stringify(bundle)).not.toContain("secret body text");
  });

  it("keys growth Bundles by wiki id so same-titled wikis do not conflate", () => {
    const mk = (id: string): WikiEntityInfo => ({
      id,
      title: "same-title",
      kind: "claim",
      status: "active",
      generatedAt: "2026-07-01T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
      documentProvenance: {
        agents: [{ id: "agent_ai_m", type: "ai", label: "m" }],
        activities: [{
          id: "edit_001", type: "wiki_ingest",
          startedAt: "2026-07-01T00:00:00Z", endedAt: "2026-07-01T00:00:00Z",
          wasAssociatedWith: "agent_ai_m",
        }],
        revisions: [{
          id: "rev_001", savedAt: "2026-07-01T00:00:00Z",
          summary: {
            blocksAdded: 1, blocksRemoved: 0, blocksModified: 0,
            labelsChanged: [], provLinksAdded: 0, provLinksRemoved: 0,
            knowledgeLinksAdded: 0, knowledgeLinksRemoved: 0,
          },
          contentHash: `h-${id}`, wasGeneratedBy: "edit_001",
        }],
      },
    });
    const doc = buildW3CProvJsonLd(emptyProv, "n", [mk("wiki-a"), mk("wiki-b")]);
    const bundles = doc["@graph"].filter((n: any) => n["@type"] === "prov:Bundle");
    const ids = bundles.map((b: any) => b["@id"]).sort();
    expect(ids).toEqual([
      "graphium:documentProvenance/wiki/wiki-a",
      "graphium:documentProvenance/wiki/wiki-b",
    ]);
    // Bundle 内の rev_001 もスコープ化されて衝突しない
    const revIds = bundles.flatMap((b: any) =>
      b["@graph"].filter((n: any) => n["@type"] === "Entity").map((n: any) => n["@id"]),
    ).sort();
    expect(revIds).toEqual([
      "graphium:documentProvenance/wiki/wiki-a/rev_001",
      "graphium:documentProvenance/wiki/wiki-b/rev_001",
    ]);
  });

  it("emits no provenance Bundle for a wiki without documentProvenance", () => {
    const wiki: WikiEntityInfo = {
      title: "no-history",
      kind: "claim",
      status: "active",
      generatedAt: "2026-07-01T00:00:00Z",
      model: "m",
      derivedFromNotes: [],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const wikiNode = findWikiNode(doc["@graph"], wiki.title);
    expect(wikiNode!["graphium:provenanceBundle"]).toBeUndefined();
    expect(doc["@graph"].find((n: any) => n["@type"] === "prov:Bundle")).toBeUndefined();
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

// ── Fix 1: block-link derived_from/reproduction_of projection reaches graphium:linkType ──

describe("buildW3CProvJsonLd — block-link linkType passthrough (edge debt Fix 1)", () => {
  it("emits graphium:linkType on the Derivation edge for a reproduction_of block-link", () => {
    const blocks = [
      { id: "ent-a", type: "paragraph", content: [{ type: "text", text: "Sample A" }], children: [] },
      { id: "ent-b", type: "paragraph", content: [{ type: "text", text: "Sample B" }], children: [] },
    ];
    const labels = new Map([
      ["ent-a", "material"],
      ["ent-b", "material"],
    ]);
    const links = [
      {
        id: "link-repro",
        sourceBlockId: "ent-b",
        targetBlockId: "ent-a",
        type: "reproduction_of" as const,
        layer: "prov" as const,
        createdBy: "human" as const,
      },
    ];
    const provDoc = generateProvDocument({ blocks, labels, links });
    const doc = buildW3CProvJsonLd(provDoc, "note-title");
    const deriv = doc["@graph"].find(
      (n: any) =>
        n["@type"] === "Derivation" &&
        n.generatedEntity === "entity_ent-b" &&
        n.usedEntity === "entity_ent-a",
    );
    expect(deriv).toBeDefined();
    expect((deriv as any)["graphium:linkType"]).toBe("reproduction_of");
  });

  it("omits graphium:linkType for a plain derived_from block-link", () => {
    const blocks = [
      { id: "ent-a", type: "paragraph", content: [{ type: "text", text: "Sample A" }], children: [] },
      { id: "ent-b", type: "paragraph", content: [{ type: "text", text: "Sample B" }], children: [] },
    ];
    const labels = new Map([
      ["ent-a", "material"],
      ["ent-b", "material"],
    ]);
    const links = [
      {
        id: "link-derived",
        sourceBlockId: "ent-b",
        targetBlockId: "ent-a",
        type: "derived_from" as const,
        layer: "prov" as const,
        createdBy: "human" as const,
      },
    ];
    const provDoc = generateProvDocument({ blocks, labels, links });
    const doc = buildW3CProvJsonLd(provDoc, "note-title");
    const deriv = doc["@graph"].find(
      (n: any) =>
        n["@type"] === "Derivation" &&
        n.generatedEntity === "entity_ent-b" &&
        n.usedEntity === "entity_ent-a",
    );
    expect(deriv).toBeDefined();
    expect((deriv as any)["graphium:linkType"]).toBeUndefined();
  });
});

// ── 他ノート output 参照（cross-note informed_by）の export 反映 ──
describe("buildW3CProvJsonLd — cross-note output references", () => {
  function baseLink(overrides: Partial<BlockLink>): BlockLink {
    return {
      id: "link-cross",
      sourceBlockId: "h-step",
      targetBlockId: "src-step",
      type: "informed_by",
      layer: "prov",
      createdBy: "human",
      targetNoteId: "note-b",
      targetEntityId: "row_123",
      sourceEntityId: "row_123",
      targetEntityLabel: "Sample X",
      targetNoteTitle: "Note B",
      targetStepTitle: "Synthesis",
      ...overrides,
    };
  }

  it("emits an external stub + Derivation when the local table-row receiver resolves", () => {
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        {
          "@id": "entity_row-node",
          "@type": "prov:Entity",
          "rdfs:label": "Sample X",
          "graphium:tableRowId": "row_123",
        } as any,
      ],
    };
    const link = baseLink({});
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link]);

    const stubId = `graphium:note/${encodeURIComponent("note-b")}/output/${encodeURIComponent("row_123")}`;
    const stub = doc["@graph"].find((n: any) => n["@id"] === stubId);
    expect(stub).toBeDefined();
    expect(stub!["graphium:external"]).toBe(true);
    expect((stub as any)["graphium:sourceNoteId"]).toBe("note-b");
    expect((stub as any)["graphium:sourceStepId"]).toBe("src-step");
    expect((stub as any)["graphium:sourceNoteTitle"]).toBe("Note B");
    expect((stub as any)["graphium:sourceStepTitle"]).toBe("Synthesis");

    const deriv = doc["@graph"].find(
      (n: any) =>
        n["@type"] === "Derivation" &&
        n.generatedEntity === "entity_row-node" &&
        n.usedEntity === stubId,
    );
    expect(deriv).toBeDefined();
    expect((deriv as any)["graphium:linkType"]).toBe("cross_note_output");
  });

  it("resolves the legacy inline-span receiver when no table-row node matches", () => {
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        {
          "@id": "inline_material_ent42",
          "@type": "prov:Entity",
          "rdfs:label": "Sample X",
        } as any,
      ],
    };
    const link = baseLink({ sourceEntityId: "ent42", targetEntityId: "ent42" });
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link]);

    const stubId = `graphium:note/${encodeURIComponent("note-b")}/output/${encodeURIComponent("ent42")}`;
    const deriv = doc["@graph"].find(
      (n: any) =>
        n["@type"] === "Derivation" &&
        n.generatedEntity === "inline_material_ent42" &&
        n.usedEntity === stubId,
    );
    expect(deriv).toBeDefined();
  });

  it("does not suffix-match an inline node whose entityId happens to contain an underscore", () => {
    // entityId 自体に "_" を含む場合、末尾一致だと inline_material_foo_bar が
    // sourceEntityId: "bar" に誤マッチしてしまう。prefix を剥がした残り全体の
    // 厳密一致でなければ弾けないことを確認する。
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        {
          "@id": "inline_material_foo_bar",
          "@type": "prov:Entity",
          "rdfs:label": "Foo bar",
        } as any,
      ],
    };
    const link = baseLink({ sourceEntityId: "bar", targetEntityId: "bar" });
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link]);

    const deriv = doc["@graph"].find(
      (n: any) => n["@type"] === "Derivation" && n.generatedEntity === "inline_material_foo_bar",
    );
    expect(deriv).toBeUndefined();
  });

  it("falls back to a Usage on the receiving step's Activity when no local node resolves", () => {
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        { "@id": "activity_h-step", "@type": "prov:Activity", "rdfs:label": "Step" } as any,
      ],
    };
    const link = baseLink({ sourceBlockId: "h-step", sourceEntityId: "row_missing" });
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link]);

    const stubId = `graphium:note/${encodeURIComponent("note-b")}/output/${encodeURIComponent("row_123")}`;
    const usage = doc["@graph"].find(
      (n: any) => n["@type"] === "Usage" && n.activity === "activity_h-step" && n.entity === stubId,
    );
    expect(usage).toBeDefined();
    const deriv = doc["@graph"].find((n: any) => n["@type"] === "Derivation" && n.usedEntity === stubId);
    expect(deriv).toBeUndefined();
  });

  it("skips the link entirely (no stub, no relation) when neither local node nor Activity resolves", () => {
    const provDoc: ProvJsonLd = { "@context": emptyProv["@context"], "@graph": [] };
    const link = baseLink({ sourceEntityId: "row_missing" });
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link]);

    const stubId = `graphium:note/${encodeURIComponent("note-b")}/output/${encodeURIComponent("row_123")}`;
    expect(doc["@graph"].find((n: any) => n["@id"] === stubId)).toBeUndefined();
  });

  it("leaves output unchanged when crossNoteLinks is omitted", () => {
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        {
          "@id": "entity_row-node",
          "@type": "prov:Entity",
          "rdfs:label": "Sample X",
          "graphium:tableRowId": "row_123",
        } as any,
      ],
    };
    const withLinks = buildW3CProvJsonLd(provDoc, "n", undefined, [baseLink({})]);
    const without = buildW3CProvJsonLd(provDoc, "n");
    // crossNoteLinks 未指定時は従来どおり Content Provenance の変換結果のみ
    expect(without["@graph"]).toEqual(buildW3CProvJsonLd(provDoc, "n")["@graph"]);
    expect(without["@graph"]).toHaveLength(1);
    expect(withLinks["@graph"].length).toBeGreaterThan(without["@graph"].length);
  });

  it("dedups identical cross-note references into a single stub and relation", () => {
    const provDoc: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        {
          "@id": "entity_row-node",
          "@type": "prov:Entity",
          "rdfs:label": "Sample X",
          "graphium:tableRowId": "row_123",
        } as any,
      ],
    };
    const link = baseLink({});
    const doc = buildW3CProvJsonLd(provDoc, "n", undefined, [link, { ...link, id: "link-cross-dup" }]);

    const stubId = `graphium:note/${encodeURIComponent("note-b")}/output/${encodeURIComponent("row_123")}`;
    const stubs = doc["@graph"].filter((n: any) => n["@id"] === stubId);
    const derivs = doc["@graph"].filter((n: any) => n["@type"] === "Derivation" && n.usedEntity === stubId);
    expect(stubs).toHaveLength(1);
    expect(derivs).toHaveLength(1);
  });
});
