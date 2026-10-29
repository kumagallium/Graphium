// Phase 4 (PR-B7): PROV-JSON-LD エクスポートに Wiki Knowledge Layer の
// 意味的な型を持ち出せていることを検証する。
//
// 検証ポイント:
// - kind ごとに該当する型だけが emit される（atom → atomType, synthesis → synthesisMode）
// - Claim の procedureContext がそのまま @graph に乗る
// - 値が未指定のフィールドは出力に含まれない

import { describe, it, expect } from "vitest";
import {
  buildW3CProvJsonLd,
  emitCrossNoteLinks,
  OPENPROVENANCE_CONTEXT_URL,
  PROV_EXPORT_CONTEXT_BASE,
  type WikiEntityInfo,
} from "./export-jsonld";
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

// ── feat/step-stage-rows: 段階（stage）の W3C 書き出し ──
describe("buildW3CProvJsonLd — stage rows (feat/step-stage-rows)", () => {
  const heading = (id: string, text: string) => ({
    id,
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text }],
    children: [],
  });

  const paramTable = (id: string, headers: string[], rows: string[][]) => ({
    id,
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: headers.map((h) => [{ type: "text", text: h }]) },
        ...rows.map((r) => ({ cells: r.map((v) => [{ type: "text", text: v }]) })),
      ],
    },
    children: [],
  });

  function buildStageDoc(): ProvJsonLd {
    return generateProvDocument({
      blocks: [
        heading("h2-sinter", "焼成する"),
        paramTable("param-3row", ["温度", "時間"], [
          ["600℃", "1h"],
          ["800℃", "2h"],
          ["1000℃", "3h"],
        ]),
      ],
      labels: new Map([
        ["h2-sinter", "procedure"],
        ["param-3row", "attribute"],
      ]),
      links: [],
    });
  }

  it("emits prov:wasInformedBy as a direct property on the stage node (no Communication reification)", () => {
    const provDoc = buildStageDoc();
    const doc = buildW3CProvJsonLd(provDoc, "note-title");

    const stage2 = doc["@graph"].find((n: any) => n["@id"] === "activity_param-3row_2") as any;
    expect(stage2).toBeDefined();
    expect(stage2["prov:wasInformedBy"]).toEqual([{ "@id": "activity_param-3row_1" }]);

    // Communication ノードへの reify はしない
    expect(doc["@graph"].some((n: any) => n["@type"] === "Communication")).toBe(false);

    const stage1 = doc["@graph"].find((n: any) => n["@id"] === "activity_param-3row_1") as any;
    expect(stage1["prov:wasInformedBy"]).toBeUndefined();
  });

  it("emits graphium:partOf / graphium:activityKind / graphium:stageIndex via extractExtensionProps", () => {
    const provDoc = buildStageDoc();
    const doc = buildW3CProvJsonLd(provDoc, "note-title");

    const stage1 = doc["@graph"].find((n: any) => n["@id"] === "activity_param-3row_1") as any;
    expect(stage1).toBeDefined();
    expect(stage1["graphium:partOf"]).toEqual([{ "@id": "activity_h2-sinter" }]);
    expect(stage1["graphium:activityKind"]).toBe("stage");
    expect(stage1["graphium:stageIndex"]).toBe(1);
    // params もそのまま拡張プロパティとして出る
    expect(stage1["graphium:温度"]).toBe("600℃");
  });

  it("does not affect the parent Activity node (no params merged, no stage-only fields)", () => {
    const provDoc = buildStageDoc();
    const doc = buildW3CProvJsonLd(provDoc, "note-title");

    const parent = doc["@graph"].find((n: any) => n["@id"] === "activity_h2-sinter") as any;
    expect(parent).toBeDefined();
    expect(parent["graphium:温度"]).toBeUndefined();
    expect(parent["graphium:activityKind"]).toBeUndefined();
    expect(parent["graphium:partOf"]).toBeUndefined();
  });

  it("a single-row [パラメータ] table keeps existing behavior unchanged (no wasInformedBy/partOf anywhere)", () => {
    const provDoc = generateProvDocument({
      blocks: [
        heading("h2-sinter", "焼成する"),
        paramTable("param-1row", ["温度", "時間"], [["800℃", "2h"]]),
      ],
      labels: new Map([
        ["h2-sinter", "procedure"],
        ["param-1row", "attribute"],
      ]),
      links: [],
    });
    const doc = buildW3CProvJsonLd(provDoc, "note-title");

    const parent = doc["@graph"].find((n: any) => n["@id"] === "activity_h2-sinter") as any;
    expect(parent["graphium:温度"]).toBe("800℃");
    expect(doc["@graph"].some((n: any) => n["@type"] === "Activity" && n["@id"]?.startsWith("activity_param-1row"))).toBe(false);
    expect(doc["@graph"].every((n: any) => n["prov:wasInformedBy"] === undefined)).toBe(true);
    expect(doc["@graph"].every((n: any) => n["graphium:partOf"] === undefined)).toBe(true);
  });
});

// ── convertContentProvenance の idPrefix / noteIri / rdfs:comment ──

describe("buildW3CProvJsonLd — idPrefix / noteIri / rdfs:comment", () => {
  const sampleProv: ProvJsonLd = {
    "@context": emptyProv["@context"],
    "@graph": [
      {
        "@id": "activity_a",
        "@type": "prov:Activity",
        "rdfs:label": "A",
        "rdfs:comment": "手順の自由記述",
        "prov:used": [{ "@id": "ent_in" }],
      },
      {
        "@id": "activity_b",
        "@type": "prov:Activity",
        "rdfs:label": "B",
        "prov:wasInformedBy": [{ "@id": "activity_a" }],
        "graphium:partOf": [{ "@id": "activity_a" }],
      },
      {
        "@id": "ent_in",
        "@type": "prov:Entity",
        "rdfs:label": "入力",
        "rdfs:comment": "図のキャプション",
        "graphium:attributes": [
          { "rdfs:label": "属性1", "rdfs:comment": "属性のキャプション" },
          { "rdfs:label": "属性2" },
        ],
      },
      {
        "@id": "ent_out",
        "@type": "prov:Entity",
        "rdfs:label": "出力",
        "prov:wasGeneratedBy": [{ "@id": "activity_b" }],
        "prov:wasDerivedFrom": [{ "@id": "ent_in", "graphium:linkType": "derived_from" }],
      },
    ] as any,
  };

  const PREFIX = "graphium:note/n1/";
  const NOTE = "graphium:note/n1";

  it("prefixes node ids, every reference and relation node ids", () => {
    const doc = buildW3CProvJsonLd(sampleProv, "t", undefined, undefined, { idPrefix: PREFIX, noteIri: NOTE });
    const g = doc["@graph"] as any[];
    const byId = (id: string) => g.find((n) => n["@id"] === id);

    // ノード @id
    expect(byId(`${PREFIX}activity_a`)).toBeDefined();
    expect(byId(`${PREFIX}ent_out`)).toBeDefined();
    // wasInformedBy / partOf の参照
    const b = byId(`${PREFIX}activity_b`);
    expect(b["prov:wasInformedBy"]).toEqual([{ "@id": `${PREFIX}activity_a` }]);
    expect(b["graphium:partOf"]).toEqual([{ "@id": `${PREFIX}activity_a` }]);
    // 関係ノード
    const usage = g.find((n) => n["@type"] === "Usage");
    expect(usage["@id"]).toBe("_:note_n1_usage_activity_a_ent_in");
    expect(usage.activity).toBe(`${PREFIX}activity_a`);
    expect(usage.entity).toBe(`${PREFIX}ent_in`);
    const gen = g.find((n) => n["@type"] === "Generation");
    expect(gen["@id"]).toBe("_:note_n1_generation_ent_out_activity_b");
    expect(gen.entity).toBe(`${PREFIX}ent_out`);
    expect(gen.activity).toBe(`${PREFIX}activity_b`);
    const der = g.find((n) => n["@type"] === "Derivation");
    expect(der["@id"]).toBe("_:note_n1_derivation_ent_out_ent_in");
    expect(der.generatedEntity).toBe(`${PREFIX}ent_out`);
    expect(der.usedEntity).toBe(`${PREFIX}ent_in`);
    expect(der["graphium:linkType"]).toBe("derived_from");

    // Activity / Entity だけに isPartOf、関係ノードには付かない
    for (const n of g) {
      if (n["@type"] === "Activity" || n["@type"] === "Entity") {
        expect(n["dcterms:isPartOf"]).toEqual({ "@id": NOTE });
      } else {
        expect(n["dcterms:isPartOf"]).toBeUndefined();
      }
    }
    // 前置されていない素の ID が残っていない
    for (const n of g) {
      for (const k of ["activity", "entity", "generatedEntity", "usedEntity"]) {
        if (typeof n[k] === "string") expect(n[k].startsWith(PREFIX)).toBe(true);
      }
    }
  });

  it("passes rdfs:comment on nodes and attributes only when present", () => {
    const doc = buildW3CProvJsonLd(sampleProv, "t");
    const g = doc["@graph"] as any[];
    expect(g.find((n) => n["@id"] === "activity_a")["rdfs:comment"]).toBe("手順の自由記述");
    const ent = g.find((n) => n["@id"] === "ent_in");
    expect(ent["rdfs:comment"]).toBe("図のキャプション");
    expect(ent["graphium:attributes"][0]["rdfs:comment"]).toBe("属性のキャプション");
    expect("rdfs:comment" in ent["graphium:attributes"][1]).toBe(false);
    expect("rdfs:comment" in g.find((n) => n["@id"] === "activity_b")).toBe(false);
    // 空文字は出さない
    const empty = buildW3CProvJsonLd(
      { ...sampleProv, "@graph": [{ "@id": "x", "@type": "prov:Entity", "rdfs:label": "x", "rdfs:comment": "" }] as any },
      "t",
    );
    expect("rdfs:comment" in (empty["@graph"][0] as any)).toBe(false);
  });

  it("is identical to the legacy output when opts are omitted", () => {
    const omitted = buildW3CProvJsonLd(sampleProv, "t");
    const emptyOpts = buildW3CProvJsonLd(sampleProv, "t", undefined, undefined, {});
    expect(JSON.stringify(emptyOpts)).toBe(JSON.stringify(omitted));
    const g = omitted["@graph"] as any[];
    // 従来の ID 形式・isPartOf なし
    expect(g.find((n) => n["@type"] === "Usage")["@id"]).toBe("_:usage_activity_a_ent_in");
    expect(g.every((n) => n["dcterms:isPartOf"] === undefined)).toBe(true);
    expect(g.find((n) => n["@id"] === "activity_b")["graphium:partOf"]).toEqual([{ "@id": "activity_a" }]);
    // context は従来どおり（2 要素・末尾はリモート）
    expect(omitted["@context"][1]).toBe(OPENPROVENANCE_CONTEXT_URL);
    expect(omitted["@context"][0]).toEqual(PROV_EXPORT_CONTEXT_BASE);
    expect(Object.keys(PROV_EXPORT_CONTEXT_BASE)[0]).toBe("prov");
  });

  it("PROV_EXPORT_CONTEXT_BASE のキーと値をべた書きで固定する（既存書き出しの @context を守る）", () => {
    expect(PROV_EXPORT_CONTEXT_BASE).toEqual({
      prov: "http://www.w3.org/ns/prov#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      graphium: "https://graphium.app/ns#",
      foaf: "http://xmlns.com/foaf/0.1/",
      dcterms: "http://purl.org/dc/terms/",
      Entity: "prov:Entity",
      Activity: "prov:Activity",
      Agent: "prov:Agent",
      Bundle: "prov:Bundle",
      Usage: "prov:Usage",
      Generation: "prov:Generation",
      Derivation: "prov:Derivation",
      Association: "prov:Association",
      Attribution: "prov:Attribution",
      label: { "@id": "rdfs:label" },
      type: { "@id": "rdf:type", "@type": "@id" },
      activity: { "@id": "prov:activity", "@type": "@id" },
      entity: { "@id": "prov:entity", "@type": "@id" },
      agent: { "@id": "prov:agent", "@type": "@id" },
      usedEntity: { "@id": "prov:entity", "@type": "@id" },
      generatedEntity: { "@reverse": "prov:qualifiedDerivation", "@type": "@id" },
      startTime: { "@id": "prov:startedAtTime", "@type": "xsd:dateTime" },
      endTime: { "@id": "prov:endedAtTime", "@type": "xsd:dateTime" },
    });
    // キーの並びも固定（順序の入れ替えで出力が変わるのを検知）
    expect(Object.keys(PROV_EXPORT_CONTEXT_BASE)).toEqual([
      "prov", "xsd", "rdf", "rdfs", "graphium", "foaf", "dcterms",
      "Entity", "Activity", "Agent", "Bundle", "Usage", "Generation", "Derivation", "Association", "Attribution",
      "label", "type", "activity", "entity", "agent", "usedEntity", "generatedEntity", "startTime", "endTime",
    ]);
  });

  it("opts 省略時の出力全体をべた書きで固定する（旧出力との一致）", () => {
    expect(buildW3CProvJsonLd(sampleProv, "t")).toMatchInlineSnapshot(`
      {
        "@context": [
          {
            "Activity": "prov:Activity",
            "Agent": "prov:Agent",
            "Association": "prov:Association",
            "Attribution": "prov:Attribution",
            "Bundle": "prov:Bundle",
            "Derivation": "prov:Derivation",
            "Entity": "prov:Entity",
            "Generation": "prov:Generation",
            "Usage": "prov:Usage",
            "activity": {
              "@id": "prov:activity",
              "@type": "@id",
            },
            "agent": {
              "@id": "prov:agent",
              "@type": "@id",
            },
            "dcterms": "http://purl.org/dc/terms/",
            "endTime": {
              "@id": "prov:endedAtTime",
              "@type": "xsd:dateTime",
            },
            "entity": {
              "@id": "prov:entity",
              "@type": "@id",
            },
            "foaf": "http://xmlns.com/foaf/0.1/",
            "generatedEntity": {
              "@reverse": "prov:qualifiedDerivation",
              "@type": "@id",
            },
            "graphium": "https://graphium.app/ns#",
            "label": {
              "@id": "rdfs:label",
            },
            "prov": "http://www.w3.org/ns/prov#",
            "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
            "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
            "startTime": {
              "@id": "prov:startedAtTime",
              "@type": "xsd:dateTime",
            },
            "type": {
              "@id": "rdf:type",
              "@type": "@id",
            },
            "usedEntity": {
              "@id": "prov:entity",
              "@type": "@id",
            },
            "xsd": "http://www.w3.org/2001/XMLSchema#",
          },
          "https://openprovenance.org/prov-jsonld/context.jsonld",
        ],
        "@graph": [
          {
            "@id": "activity_a",
            "@type": "Activity",
            "label": [
              {
                "@value": "A",
              },
            ],
            "rdfs:comment": "手順の自由記述",
          },
          {
            "@id": "_:usage_activity_a_ent_in",
            "@type": "Usage",
            "activity": "activity_a",
            "entity": "ent_in",
          },
          {
            "@id": "activity_b",
            "@type": "Activity",
            "graphium:partOf": [
              {
                "@id": "activity_a",
              },
            ],
            "label": [
              {
                "@value": "B",
              },
            ],
            "prov:wasInformedBy": [
              {
                "@id": "activity_a",
              },
            ],
          },
          {
            "@id": "ent_in",
            "@type": "Entity",
            "graphium:attributes": [
              {
                "label": [
                  {
                    "@value": "属性1",
                  },
                ],
                "rdfs:comment": "属性のキャプション",
              },
              {
                "label": [
                  {
                    "@value": "属性2",
                  },
                ],
              },
            ],
            "label": [
              {
                "@value": "入力",
              },
            ],
            "rdfs:comment": "図のキャプション",
          },
          {
            "@id": "ent_out",
            "@type": "Entity",
            "label": [
              {
                "@value": "出力",
              },
            ],
          },
          {
            "@id": "_:generation_ent_out_activity_b",
            "@type": "Generation",
            "activity": "activity_b",
            "entity": "ent_out",
          },
          {
            "@id": "_:derivation_ent_out_ent_in",
            "@type": "Derivation",
            "generatedEntity": "ent_out",
            "graphium:linkType": "derived_from",
            "usedEntity": "ent_in",
          },
        ],
      }
    `);
  });

  it("emitCrossNoteLinks prefixes the receiving node and activity ids", () => {
    const prov: ProvJsonLd = {
      "@context": emptyProv["@context"],
      "@graph": [
        { "@id": "activity_s1", "@type": "prov:Activity", "rdfs:label": "S1" },
        { "@id": "recv", "@type": "prov:Entity", "rdfs:label": "受け", "graphium:tableRowId": "row1" },
      ] as any,
    };
    const base = { type: "informed_by", targetNoteId: "other", targetBlockId: "tb", targetEntityId: "te" };
    const viaEntity = emitCrossNoteLinks(
      prov,
      [{ ...base, sourceBlockId: "s1", sourceEntityId: "row1" } as any],
      { idPrefix: PREFIX },
    );
    const der = viaEntity.find((n) => n["@type"] === "Derivation")!;
    expect(der.generatedEntity).toBe(`${PREFIX}recv`);
    expect(der.usedEntity).toBe("graphium:note/other/output/te"); // 外部スタブは前置しない
    const viaActivity = emitCrossNoteLinks(prov, [{ ...base, sourceBlockId: "s1" } as any], { idPrefix: PREFIX });
    expect(viaActivity.find((n) => n["@type"] === "Usage")!.activity).toBe(`${PREFIX}activity_s1`);
    // 省略時は従来どおり
    const legacy = emitCrossNoteLinks(prov, [{ ...base, sourceBlockId: "s1" } as any]);
    expect(legacy.find((n) => n["@type"] === "Usage")!.activity).toBe("activity_s1");
  });
});
