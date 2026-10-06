import { describe, expect, it } from "vitest";

import type { GraphiumDocument } from "../../lib/document-types";
import { agentLabelFor, buildActor, stampGeneratedBy } from "./actor";

describe("actor", () => {
  it("buildActor は undefined を入れない", () => {
    expect(buildActor()).toEqual({ via: "mcp" });
    expect(buildActor("claude-code", "m")).toEqual({ via: "mcp", client: "claude-code", model: "m" });
    expect("client" in buildActor(undefined, "m")).toBe(false);
  });
  it("agentLabelFor", () => {
    expect(agentLabelFor("claude-desktop")).toBe("graphium-mcp (claude-desktop)");
    expect(agentLabelFor()).toBe("graphium-mcp");
  });
  it("stampGeneratedBy は save-answer と同じ形で打つ", () => {
    const doc = { generatedBy: { agent: "ai" } } as unknown as GraphiumDocument;
    stampGeneratedBy(doc, { client: "c", sessionId: "s", model: "m1" });
    expect(doc.generatedBy).toMatchObject({ agent: "graphium-mcp (c)", sessionId: "s", model: "m1" });
    expect((doc.generatedBy as { user: { username: string } }).user.username).toBeTruthy();
    stampGeneratedBy(doc, {});
    expect(doc.generatedBy).toMatchObject({ agent: "graphium-mcp", sessionId: "unknown" });
    expect("model" in (doc.generatedBy as object)).toBe(false);
  });
});
