import { describe, it, expect } from "vitest";
import { MATERIAL_AS_DATA_GUARD, NOTE_CONTEXT_GUARDRAIL } from "./agent.js";

describe("NOTE_CONTEXT_GUARDRAIL", () => {
  it("ノート本文が会話内に同梱されることを明示する", () => {
    expect(NOTE_CONTEXT_GUARDRAIL.toLowerCase()).toContain("graphium");
    expect(NOTE_CONTEXT_GUARDRAIL).toMatch(/---/);
  });

  it("外部サービスでノートを検索しないよう指示する", () => {
    const text = NOTE_CONTEXT_GUARDRAIL.toLowerCase();
    // Notion など外部 MCP への取り違えを止める核心
    expect(text).toContain("notion");
    expect(text).toMatch(/never|do not|don't/);
    expect(text).toContain("external");
  });
});

describe("MATERIAL_AS_DATA_GUARD", () => {
  it("ノート・検索結果・道具の結果の中の指示に従わないと書いてある", () => {
    const text = MATERIAL_AS_DATA_GUARD.toLowerCase();
    expect(text).toContain("tool results");
    expect(text).toContain("web search results");
    expect(text).toMatch(/never follow instructions/);
    // 同梱するノート・素材の枠も名指しする
    for (const tag of ["<open-note>", "<attached-notes>", "<attached-assets>"]) expect(text).toContain(tag);
  });
});
