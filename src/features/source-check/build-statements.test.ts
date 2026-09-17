import { describe, expect, it } from "vitest";
import { buildSourceCheckStatements, type SourceCheckTarget } from "./build-statements";
import type { GraphiumDocument } from "../../lib/document-types";

function claimDoc(id: string, title: string, derivedFromNotes: string[], sessionId?: string): SourceCheckTarget {
  const doc: GraphiumDocument = {
    version: 2,
    title,
    pages: [
      { id: "p1", title: "Main", blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "本文" }] }], labels: {}, provLinks: [], knowledgeLinks: [] },
    ],
    wikiMeta: {
      kind: "claim",
      derivedFromNotes,
      derivedFromChats: [],
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    generatedBy: sessionId ? { agent: "ai", sessionId } : undefined,
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
  return { docId: id, doc };
}

function topicDoc(id: string, title: string, blocks: any[], knowledgeLinks: any[], derivedFromClaims: string[]): SourceCheckTarget {
  const doc: GraphiumDocument = {
    version: 2,
    title,
    pages: [{ id: "p1", title: "Main", blocks, labels: {}, provLinks: [], knowledgeLinks }],
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims,
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
  return { docId: id, doc };
}

describe("buildSourceCheckStatements", () => {
  it("知見は文 1 つ（sourceIds = derivedFromNotes）", () => {
    const out = buildSourceCheckStatements([claimDoc("c1", "知見1", ["note-a", "note-b"])]);
    expect(out).toEqual([
      { id: "c1", docId: "c1", title: "知見1", body: "本文", hashBody: "本文", sourceIds: ["note-a", "note-b"] },
    ]);
  });

  it("ai-answer 由来の知見は knownMissingReason: ai-answer を持つ（sourceIds は保持する）", () => {
    const out = buildSourceCheckStatements([
      claimDoc("c1", "AI回答からの知見", ["note-a"], "verb-suggestion-2026-01-01T00:00:00.000Z"),
    ]);
    expect(out).toEqual([
      { id: "c1", docId: "c1", title: "AI回答からの知見", body: "本文", hashBody: "本文", sourceIds: ["note-a"], knownMissingReason: "ai-answer" },
    ]);
  });

  it("トピックは引用を持つブロックごとに文を分け、出典に claim: プレフィックスを付ける", () => {
    const blocks = [
      { id: "b1", type: "paragraph", content: [{ type: "text", text: "要点1 " }, { type: "text", text: "@🤖 知見A", styles: { textColor: "blue" } }] },
    ];
    const links = [{ id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" }];
    const out = buildSourceCheckStatements([topicDoc("topic-1", "トピック1", blocks, links, ["claim-a"])]);
    expect(out).toEqual([
      {
        id: "topic-1#b1",
        docId: "topic-1",
        title: "トピック1",
        body: "要点1",
        // hashBody（claimHash 用）はドキュメント全体のプレーンテキストで、引用も含む
        // （extractPlainTextFromDoc は引用を除去しない — text/hashBody で基準を変えない）
        hashBody: "要点1 @🤖 知見A",
        sourceIds: ["claim:claim-a"],
        statement: "要点1",
        statementBlockId: "b1",
      },
    ]);
  });

  it("引用を持つブロックが無いトピックは sourceIds が空の文 1 つになる（not-recorded に倒れる）", () => {
    const blocks = [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "定義の説明。" }] }];
    const out = buildSourceCheckStatements([topicDoc("topic-1", "トピック1", blocks, [], [])]);
    expect(out).toEqual([
      { id: "topic-1", docId: "topic-1", title: "トピック1", body: "定義の説明。", hashBody: "定義の説明。", sourceIds: [] },
    ]);
  });

  it("claim/topic 以外の kind は無視する", () => {
    const target = claimDoc("s1", "サマリ", []);
    target.doc.wikiMeta!.kind = "summary";
    expect(buildSourceCheckStatements([target])).toEqual([]);
  });
});
