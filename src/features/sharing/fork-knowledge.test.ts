// forkSharedKnowledge のテスト。share → fork のラウンドトリップで
// wikiMeta の環境依存フィールドがリセットされることを確認する。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareKnowledge } from "./share-knowledge";
import { shareNote } from "./share-note";
import { forkSharedKnowledge } from "./fork-knowledge";
import type { GraphiumDocument } from "../../lib/document-types";
import type { AuthorIdentity } from "../document-provenance/types";

const author: AuthorIdentity = { name: "Ada", email: "a@b.co" };

class FakeFs {
  entries = new Map<string, string>();
  install() {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string, args: any) => {
      switch (cmd) {
        case "shared_write":
          this.entries.set(`${args.entryType}/${args.id}`, args.content);
          return null;
        case "shared_read": {
          const v = this.entries.get(`${args.entryType}/${args.id}`);
          if (!v) throw new Error("not found");
          return v;
        }
        default:
          throw new Error(`unmocked: ${cmd}`);
      }
    });
  }
}

let fs: FakeFs;
beforeEach(() => {
  fs = new FakeFs();
  fs.install();
});

function makeWikiDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 5,
    title: "Sintering claim",
    source: "ai",
    pages: [
      {
        id: "p1",
        title: "Sintering claim",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: ["peer-note-1", "peer-note-2"],
      derivedFromChats: ["peer-chat-1"],
      derivedFromClaims: ["peer-claim-1"],
      citedKnowledgeIds: ["peer-wiki-1"],
      relatedAtoms: [
        { atomId: "peer-atom-1", relationType: "similar" as never, citation: "…" },
      ],
      sectionEmbeddings: [{ sectionId: "s1", modelVersion: "m1" }],
      grounding: { validity: { verdict: "supported" } },
      backing: [
        { source: "internal-claim", citation: "based on X", internalClaimId: "peer-claim-2" },
        { source: "textbook", citation: "Kingery" },
      ],
      editedSections: ["b1"],
      theme: "ceramics",
      epistemicStatus: "interpretation" as never,
      generatedAt: "2026-05-04T00:00:00Z",
      generatedBy: { model: "test-model", version: "1" },
    },
    documentProvenance: { revisions: [], activities: [] } as never,
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
    ...overrides,
  } as GraphiumDocument;
}

describe("forkSharedKnowledge", () => {
  it("round-trips share → fork and resets environment-bound wikiMeta fields", async () => {
    const shared = await shareKnowledge(makeWikiDoc(), { root: "/shared", author });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    const fork = await forkSharedKnowledge(shared.entry.id, { root: "/shared" });
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;

    const doc = fork.doc;
    expect(doc.title).toBe("Sintering claim (forked)");
    expect(doc.sharedRef).toBeUndefined();
    expect(doc.documentProvenance).toBeUndefined();
    expect(doc.forkedFrom?.sharedId).toBe(shared.entry.id);
    expect(doc.forkedFrom?.authorEmail).toBe(author.email);

    // 共有元環境のローカル ID はリセット
    const meta = doc.wikiMeta!;
    expect(meta.derivedFromNotes).toEqual([]);
    expect(meta.derivedFromChats).toEqual([]);
    expect(meta.derivedFromClaims).toBeUndefined();
    expect(meta.citedKnowledgeIds).toBeUndefined();
    expect(meta.relatedAtoms).toBeUndefined();
    expect(meta.sectionEmbeddings).toBeUndefined();
    expect(meta.grounding).toBeUndefined();
    // backing は citation 文言を残し internalClaimId だけ剥がす
    expect(meta.backing).toHaveLength(2);
    expect(meta.backing?.[0].citation).toBe("based on X");
    expect(meta.backing?.[0].internalClaimId).toBeUndefined();

    // 内容・分類フィールドは保持
    expect(meta.kind).toBe("claim");
    expect(meta.theme).toBe("ceramics");
    expect(meta.editedSections).toEqual(["b1"]);
  });

  it("rejects non-knowledge entries", async () => {
    const noteDoc: GraphiumDocument = {
      ...makeWikiDoc({ wikiMeta: undefined, source: undefined }),
      title: "A note",
    };
    const shared = await shareNote(noteDoc, { root: "/shared", author });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;

    const fork = await forkSharedKnowledge(shared.entry.id, { root: "/shared" });
    expect(fork.ok).toBe(false);
    if (fork.ok) return;
    expect(fork.error).toMatch(/Cannot fork note/);
  });

  it("fails cleanly for a missing id", async () => {
    const fork = await forkSharedKnowledge("0198c0de-0000-7000-8000-000000000000", {
      root: "/shared",
    });
    expect(fork.ok).toBe(false);
  });
});
