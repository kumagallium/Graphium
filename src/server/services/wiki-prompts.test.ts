import { describe, expect, it } from "vitest";

import { buildIngestPrompt, buildRewritePrompt } from "./wiki-prompts";

describe("buildIngestPrompt", () => {
  const base = {
    noteId: "n1",
    noteTitle: "ノート",
    noteContent: "本文です",
    existingWikiTitles: [
      { id: "k1", title: "既存の知見", kind: "claim" as const },
      { id: "t1", title: "トピック", kind: "topic" as const },
    ],
    language: "ja",
    knowledgeSchema: "SCHEMA-MARK",
  };

  it("ユーザーメッセージにタイトルと本文、システムプロンプトにスキーマと知見の一覧（番号つき）が入る", () => {
    const r = buildIngestPrompt(base);
    expect(r.userMessage).toContain('Source note title: "ノート"');
    expect(r.userMessage).toContain("本文です");
    expect(r.systemPrompt).toContain("## Knowledge Schema\n\nSCHEMA-MARK");
    expect(r.systemPrompt).toContain("c1: 既存の知見");
    expect(r.existingIndex.refToId.get("c1")).toBe("k1");
    expect(r.existingIndex.omitted).toBe(0);
  });

  it("PROV 要約があれば先頭に添える。Skill は Applied Skills に入る", () => {
    const r = buildIngestPrompt({
      ...base,
      provSummary: { activities: [{ type: "heating", label: "加熱", inputs: ["試料"] }], results: [] },
      skills: [{ title: "Voice", prompt: "VOICE-MARK" }],
    });
    expect(r.userMessage.startsWith("Source note title") || r.userMessage.includes("加熱")).toBe(true);
    expect(r.systemPrompt).toContain("VOICE-MARK");
  });

  it("noteId の prefix で文書モード・メモモードに切り替わる", () => {
    const note = buildIngestPrompt(base).systemPrompt;
    expect(buildIngestPrompt({ ...base, noteId: "pdf:x" }).systemPrompt).not.toBe(note);
    expect(buildIngestPrompt({ ...base, noteId: "memo:x" }).systemPrompt).not.toBe(note);
  });
});

describe("buildRewritePrompt", () => {
  it("[EDITED] の印・スキーマ・Skill を含む", () => {
    const r = buildRewritePrompt({
      existingSections: [{ heading: "A", content: "既存" }],
      newSections: [{ heading: "B", content: "新" }],
      editedSectionHeadings: ["A"],
      language: "ja",
      skills: [{ title: "Voice", prompt: "VOICE-MARK" }],
      knowledgeSchema: "SCHEMA-MARK",
    });
    expect(r.userMessage).toContain("## A [EDITED]");
    expect(r.userMessage).toContain("# New Information to Integrate");
    expect(r.systemPrompt).toContain("VOICE-MARK");
    expect(r.systemPrompt).toContain("## Knowledge Schema\n\nSCHEMA-MARK");
  });
});
