import { describe, expect, it } from "vitest";
import { attachSourceCheck } from "./attach";
import type { GraphiumDocument, SourceCheckProfile, WikiMeta } from "../../lib/document-types";

const NOW = "2026-05-21T10:00:00.000Z";

function baseMeta(overrides: Partial<WikiMeta> = {}): WikiMeta {
  return {
    kind: "claim",
    derivedFromNotes: ["note-x"],
    derivedFromChats: [],
    generatedAt: NOW,
    generatedBy: { model: "test-model", version: "1.0.0" },
    epistemicStatus: "interpretation",
    hypothesisStatus: "speculative",
    level: "principle",
    status: "candidate",
    ...overrides,
  } as WikiMeta;
}

function baseDoc(meta: WikiMeta): GraphiumDocument {
  return {
    version: 2,
    title: "知見X",
    wikiMeta: meta,
    pages: [{ id: "p1", title: "Main", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: NOW,
    modifiedAt: NOW,
  } as GraphiumDocument;
}

const profile: SourceCheckProfile = {
  verdict: "supported",
  entries: [{ sourceId: "note-x", sourceKind: "note", verdict: "supported", rationale: "書いてある" }],
  checkedAt: NOW,
  checkedBy: "test-model",
  claimHash: "sha256:abc",
};

describe("attachSourceCheck", () => {
  it("wikiMeta.sourceCheck を差し替える", () => {
    const doc = baseDoc(baseMeta());
    const next = attachSourceCheck(doc, profile);
    expect(next.wikiMeta?.sourceCheck).toEqual(profile);
  });

  it("epistemicStatus / hypothesisStatus / status / title / 本文などの他フィールドは一切書き換えない", () => {
    const doc = baseDoc(baseMeta({ status: "verified", confidence: 0.7 }));
    const next = attachSourceCheck(doc, profile);
    expect(next.wikiMeta?.epistemicStatus).toBe("interpretation");
    expect(next.wikiMeta?.hypothesisStatus).toBe("speculative");
    expect(next.wikiMeta?.status).toBe("verified");
    expect(next.wikiMeta?.confidence).toBe(0.7);
    expect(next.title).toBe("知見X");
  });

  it("既存の grounding は温存する（世界照合とは別レーン）", () => {
    const doc = baseDoc(baseMeta({ grounding: { validity: { verdict: "established", checkedAt: NOW } } }));
    const next = attachSourceCheck(doc, profile);
    expect(next.wikiMeta?.grounding?.validity?.verdict).toBe("established");
    expect(next.wikiMeta?.sourceCheck).toEqual(profile);
  });

  it("profile が undefined のとき sourceCheck を削除する", () => {
    const doc = baseDoc(baseMeta({ sourceCheck: profile }));
    const next = attachSourceCheck(doc, undefined);
    expect(next.wikiMeta?.sourceCheck).toBeUndefined();
    expect("sourceCheck" in (next.wikiMeta as object)).toBe(false);
  });

  it("wikiMeta を持たないドキュメントには何もしない", () => {
    const doc = { ...baseDoc(baseMeta()), wikiMeta: undefined };
    const next = attachSourceCheck(doc, profile);
    expect(next).toBe(doc);
  });
});
