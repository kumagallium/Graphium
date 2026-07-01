import { describe, it, expect } from "vitest";
import { NOTE_CONTEXT_GUARDRAIL } from "./agent.js";

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
