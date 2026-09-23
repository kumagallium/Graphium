import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";

describe("Knowledge Schema 必須 endpoint", () => {
  const wikiCases = [
    {
      path: "ingest",
      body: {
        noteId: "note-1",
        noteContent: "content",
        noteTitle: "title",
        existingWikiTitles: [],
        language: "ja",
      },
    },
    {
      path: "rewrite",
      body: { existingSections: [], newSections: [], sourceNoteTitle: "source", language: "ja" },
    },
    {
      path: "consolidate-topics",
      body: { language: "ja", existingTopics: [], proposedTitles: ["Topic"] },
    },
    {
      path: "route-topics",
      body: { language: "ja", source: { id: "source-1", title: "Source", text: "body" }, existingTopics: [] },
    },
    {
      path: "revise-topic",
      body: { title: "Topic", currentBody: "", language: "ja", source: { id: "source-1", title: "Source", text: "body" } },
    },
    {
      path: "merge-topics",
      body: { title: "Topic", language: "ja", bodies: ["one", "two"] },
    },
  ] as const;

  for (const { path, body } of wikiCases) {
    it(`POST /api/wiki/${path} は非文字列 Schema を 400 にする`, async () => {
      const app = createApp({ mode: "node" });
      const res = await app.request(`http://localhost/api/wiki/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, knowledgeSchema: { invalid: true } }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "knowledgeSchema is required" });
    });
  }

  it("POST /api/agent/run は非文字列 Schema を 400 にする", async () => {
    const app = createApp({ mode: "node" });
    const res = await app.request("http://localhost/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello", knowledge_schema: 123 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "knowledge_schema is required" });
  });
});
