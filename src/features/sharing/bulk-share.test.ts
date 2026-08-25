// bulkShare のテスト。share コアは share-note / share-knowledge のテストが
// 押さえているので、ここでは集計・継続・キャンセル・書き戻し失敗の扱いに絞る。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { bulkShare, type BulkShareDeps } from "./bulk-share";
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

function makeNote(title: string): GraphiumDocument {
  return {
    version: 5,
    title,
    pages: [
      {
        id: "p1",
        title,
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
  } as GraphiumDocument;
}

function makeWiki(title: string): GraphiumDocument {
  return {
    ...makeNote(title),
    source: "ai",
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: "2026-05-04T00:00:00Z",
      generatedBy: { model: "m", version: "1" },
    },
  } as GraphiumDocument;
}

function makeDeps(overrides: Partial<BulkShareDeps> = {}): {
  deps: BulkShareDeps;
  savedNotes: Map<string, GraphiumDocument>;
  savedWikis: Map<string, GraphiumDocument>;
} {
  const notes = new Map<string, GraphiumDocument>([
    ["n1", makeNote("Note one")],
    ["n2", makeNote("Note two")],
  ]);
  const wikis = new Map<string, GraphiumDocument>([["w1", makeWiki("Claim one")]]);
  const savedNotes = new Map<string, GraphiumDocument>();
  const savedWikis = new Map<string, GraphiumDocument>();
  const deps: BulkShareDeps = {
    root: "/shared",
    author,
    loadNote: async (id) => notes.get(id) ?? null,
    saveNote: async (id, doc) => {
      savedNotes.set(id, doc);
    },
    loadKnowledge: async (id) => wikis.get(id) ?? null,
    saveKnowledge: async (id, doc) => {
      savedWikis.set(id, doc);
      return true;
    },
    ...overrides,
  };
  return { deps, savedNotes, savedWikis };
}

describe("bulkShare", () => {
  it("shares a mix of notes and knowledge, writing sharedRef back", async () => {
    const { deps, savedNotes, savedWikis } = makeDeps();
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "w1", kind: "knowledge" },
      ],
      deps,
    );
    expect(summary.shared).toBe(2);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.cancelled).toBe(false);
    expect(savedNotes.get("n1")?.sharedRef?.type).toBe("note");
    expect(savedWikis.get("w1")?.sharedRef?.type).toBe("knowledge");
  });

  it("continues past a missing document and reports it as failed", async () => {
    const { deps } = makeDeps();
    const summary = await bulkShare(
      [
        { id: "missing", kind: "note" },
        { id: "n2", kind: "note" },
      ],
      deps,
    );
    expect(summary.failed).toBe(1);
    expect(summary.shared).toBe(1);
    expect(summary.results[0].error).toMatch(/not found/i);
  });

  it("counts re-shares as updates", async () => {
    const { deps, savedNotes } = makeDeps();
    await bulkShare([{ id: "n1", kind: "note" }], deps);
    // 1 回目の sharedRef 付き doc を次回のロード結果にする
    const withRef = savedNotes.get("n1")!;
    const summary = await bulkShare([{ id: "n1", kind: "note" }], {
      ...deps,
      loadNote: async () => withRef,
    });
    expect(summary.updated).toBe(1);
    expect(summary.shared).toBe(0);
  });

  it("treats saveKnowledge returning false as a failure", async () => {
    const { deps } = makeDeps({ saveKnowledge: async () => false });
    const summary = await bulkShare([{ id: "w1", kind: "knowledge" }], deps);
    expect(summary.failed).toBe(1);
    expect(summary.results[0].error).toMatch(/sharedRef/);
  });

  it("stops at cancellation and reports partial results", async () => {
    let processed = 0;
    const { deps } = makeDeps({
      onProgress: () => {
        processed++;
      },
      isCancelled: () => processed >= 1,
    });
    const summary = await bulkShare(
      [
        { id: "n1", kind: "note" },
        { id: "n2", kind: "note" },
      ],
      deps,
    );
    expect(summary.cancelled).toBe(true);
    expect(summary.results).toHaveLength(1);
  });
});
