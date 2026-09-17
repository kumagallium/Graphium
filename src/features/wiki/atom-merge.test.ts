// 洞察（Atom）の統合（mergeAtomsExplicit）のテスト。
// deps はすべてスタブし、docs は id → doc の Map で表現する（topic-stage.test.ts と同じ流儀）。

import { describe, it, expect, vi } from "vitest";
import { mergeAtomsExplicit, type MergeAtomsDeps } from "./atom-merge";
import type { GraphiumDocument, WikiMeta } from "../../lib/document-types";

function makeAtomDoc(
  title: string,
  overrides: Partial<WikiMeta> = {},
): GraphiumDocument {
  const wikiMeta: WikiMeta = {
    kind: "atom",
    derivedFromNotes: [],
    derivedFromChats: [],
    generatedAt: new Date().toISOString(),
    generatedBy: { model: "test-model", version: "1.0.0" },
    ...overrides,
  };
  return {
    version: 2,
    title,
    pages: [{ id: "main", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    source: "ai",
    wikiMeta,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

function makeDeps(
  docs: Map<string, GraphiumDocument>,
  overrides: Partial<MergeAtomsDeps> = {},
): MergeAtomsDeps {
  return {
    loadDoc: vi.fn(async (id: string) => docs.get(id) ?? null),
    getCachedDoc: vi.fn((id: string) => docs.get(id) ?? null),
    handleSaveWikiFile: vi.fn(async (wikiId: string, doc: GraphiumDocument) => {
      docs.set(`wiki:${wikiId}`, doc);
      return true;
    }),
    handleArchiveWikiFile: vi.fn(async () => {}),
    regenerateWiki: vi.fn(async () => ({ ok: true })),
    log: () => {},
    ...overrides,
  };
}

describe("mergeAtomsExplicit", () => {
  it("merges derivedFromClaims, relatedAtoms, and conflictsWith from the absorbed atom into the kept one", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set(
      "wiki:atom-keep",
      makeAtomDoc("Keep", {
        derivedFromClaims: ["claim-1"],
        relatedAtoms: [{ atomId: "atom-other", relationType: "extends", citation: "shares mechanism" }],
        conflictsWith: ["atom-conflict-1"],
      }),
    );
    docs.set(
      "wiki:atom-absorb",
      makeAtomDoc("Absorb", {
        derivedFromClaims: ["claim-2"],
        relatedAtoms: [{ atomId: "atom-third", relationType: "shares-mechanism", citation: "same axis" }],
        conflictsWith: ["atom-conflict-2"],
      }),
    );
    const deps = makeDeps(docs);

    const result = await mergeAtomsExplicit("atom-keep", ["atom-absorb"], deps);

    const keptDoc = docs.get("wiki:atom-keep")!;
    expect(keptDoc.wikiMeta!.derivedFromClaims).toEqual(expect.arrayContaining(["claim-1", "claim-2"]));
    expect(keptDoc.wikiMeta!.derivedFromClaims).toHaveLength(2);
    const relatedIds = (keptDoc.wikiMeta!.relatedAtoms ?? []).map((r) => r.atomId);
    expect(relatedIds).toEqual(expect.arrayContaining(["atom-other", "atom-third"]));
    expect(keptDoc.wikiMeta!.conflictsWith).toEqual(expect.arrayContaining(["atom-conflict-1", "atom-conflict-2"]));

    expect(deps.handleArchiveWikiFile).toHaveBeenCalledWith("atom-absorb");
    expect(deps.regenerateWiki).toHaveBeenCalledWith("atom-keep");
    expect(result).toEqual({ merged: 1, regenerated: true, failed: 0 });
  });

  it("does not create a self-reference when the absorbed atom relates back to the kept one", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:atom-keep", makeAtomDoc("Keep", {}));
    docs.set(
      "wiki:atom-absorb",
      makeAtomDoc("Absorb", {
        relatedAtoms: [{ atomId: "atom-keep", relationType: "extends", citation: "points back at keep" }],
        conflictsWith: ["atom-keep"],
      }),
    );
    const deps = makeDeps(docs);

    await mergeAtomsExplicit("atom-keep", ["atom-absorb"], deps);

    const keptDoc = docs.get("wiki:atom-keep")!;
    expect(keptDoc.wikiMeta!.relatedAtoms ?? []).toHaveLength(0);
    expect(keptDoc.wikiMeta!.conflictsWith ?? []).toHaveLength(0);
  });

  it("does not create a reference between two absorbed atoms pointing at each other", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:atom-keep", makeAtomDoc("Keep", {}));
    docs.set(
      "wiki:atom-absorb-1",
      makeAtomDoc("Absorb 1", {
        relatedAtoms: [{ atomId: "atom-absorb-2", relationType: "extends", citation: "points at sibling" }],
      }),
    );
    docs.set("wiki:atom-absorb-2", makeAtomDoc("Absorb 2", {}));
    const deps = makeDeps(docs);

    const result = await mergeAtomsExplicit("atom-keep", ["atom-absorb-1", "atom-absorb-2"], deps);

    const keptDoc = docs.get("wiki:atom-keep")!;
    expect(keptDoc.wikiMeta!.relatedAtoms ?? []).toHaveLength(0);
    expect(result.merged).toBe(2);
  });

  it("archives every absorbed atom (soft, reversible) rather than deleting it", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:atom-keep", makeAtomDoc("Keep", {}));
    docs.set("wiki:atom-absorb-a", makeAtomDoc("Absorb A", {}));
    docs.set("wiki:atom-absorb-b", makeAtomDoc("Absorb B", {}));
    const deps = makeDeps(docs);

    const result = await mergeAtomsExplicit("atom-keep", ["atom-absorb-a", "atom-absorb-b"], deps);

    expect(deps.handleArchiveWikiFile).toHaveBeenCalledWith("atom-absorb-a");
    expect(deps.handleArchiveWikiFile).toHaveBeenCalledWith("atom-absorb-b");
    expect(result.merged).toBe(2);
  });

  it("is a no-op when absorbIds only contains the keep id itself", async () => {
    const docs = new Map<string, GraphiumDocument>();
    docs.set("wiki:atom-keep", makeAtomDoc("Keep", {}));
    const deps = makeDeps(docs);

    const result = await mergeAtomsExplicit("atom-keep", ["atom-keep"], deps);

    expect(result).toEqual({ merged: 0, regenerated: false, failed: 0 });
    expect(deps.handleSaveWikiFile).not.toHaveBeenCalled();
  });
});
