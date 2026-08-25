// shareKnowledge のテスト。Tauri invoke をモックしてラウンドトリップを確認する。
// フローの大部分は share-note.test.ts が押さえているので、ここでは
// Knowledge 固有（type / extra.wikiKind / wikiMeta 必須）に絞る。

import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { shareKnowledge } from "./share-knowledge";
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
      derivedFromNotes: ["local-note-1"],
      derivedFromChats: [],
      generatedAt: "2026-05-04T00:00:00Z",
      generatedBy: { model: "test-model", version: "1" },
    },
    createdAt: "2026-05-04T00:00:00Z",
    modifiedAt: "2026-05-04T00:00:00Z",
    ...overrides,
  } as GraphiumDocument;
}

describe("shareKnowledge", () => {
  it("writes a knowledge entry with wikiKind in extra and returns sharedRef", async () => {
    const result = await shareKnowledge(makeWikiDoc(), { root: "/shared", author });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.type).toBe("knowledge");
    expect(result.entry.extra?.wikiKind).toBe("claim");
    expect(result.entry.extra?.title).toBe("Sintering claim");
    expect(result.doc.sharedRef?.type).toBe("knowledge");
    expect(result.doc.sharedRef?.id).toBe(result.entry.id);
    expect(result.isUpdate).toBe(false);
    // knowledge フォルダに書かれている
    expect(fs.entries.has(`knowledge/${result.entry.id}`)).toBe(true);
    // body は wikiMeta 込みで完全復元できる（コピー semantics）
    const stored = JSON.parse(fs.entries.get(`knowledge/${result.entry.id}`)!);
    const body = JSON.parse(atob(stored.body_base64)) as GraphiumDocument;
    expect(body.wikiMeta?.kind).toBe("claim");
    expect(body.wikiMeta?.derivedFromNotes).toEqual(["local-note-1"]);
  });

  it("rejects a document without wikiMeta", async () => {
    const result = await shareKnowledge(
      makeWikiDoc({ wikiMeta: undefined }),
      { root: "/shared", author },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/wikiMeta/);
  });

  it("re-share overwrites the same id (minor revision)", async () => {
    const first = await shareKnowledge(makeWikiDoc(), { root: "/shared", author });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = await shareKnowledge(first.doc, { root: "/shared", author });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.entry.id).toBe(first.entry.id);
    expect(second.isUpdate).toBe(true);
  });
});
