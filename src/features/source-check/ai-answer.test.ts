import { describe, expect, it } from "vitest";
import { isAiAnswerClaim } from "./ai-answer";
import type { GraphiumDocument } from "../../lib/document-types";

function doc(sessionId?: string): GraphiumDocument {
  return {
    version: 2,
    title: "知見",
    pages: [{ id: "p1", title: "Main", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    generatedBy: sessionId ? { agent: "ai", sessionId } : undefined,
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

describe("isAiAnswerClaim", () => {
  it("sessionId が verb-suggestion- で始まれば true", () => {
    expect(isAiAnswerClaim(doc("verb-suggestion-2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("通常の ingest 由来（wiki-topic- 等）は false", () => {
    expect(isAiAnswerClaim(doc("wiki-topic-2026-01-01T00:00:00.000Z"))).toBe(false);
    expect(isAiAnswerClaim(doc("wiki-ingest-2026-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("generatedBy / sessionId が無ければ false", () => {
    expect(isAiAnswerClaim(doc(undefined))).toBe(false);
  });
});
