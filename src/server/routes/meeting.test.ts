import { describe, it, expect, vi } from "vitest";

vi.mock("../services/llm.js", () => ({ createModel: vi.fn(async () => ({})) }));
vi.mock("../services/header-model.js", () => ({
  resolveModelConfig: vi.fn(() => ({ modelId: "m1" })),
}));
vi.mock("../services/agent-loop.js", () => ({
  runAgentLoop: vi.fn(async () => ({
    message: JSON.stringify({ decisions: [{ text: "A", sources: ["u1", "bad"] }], todos: [], issues: [] }),
    model: "m1",
    tokenUsage: { inputTokens: 1, outputTokens: 2 },
  })),
}));

import meeting from "./meeting.js";

const post = (body: unknown) =>
  meeting.request("/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /summarize", () => {
  it("要約を返し未知 id を落とす", async () => {
    const res = await post({
      language: "ja",
      utterances: [{ id: "uuid-1", track: "mic", startMs: 0, text: "決めた" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.decisions).toEqual([{ text: "A", sources: ["uuid-1"] }]);
    expect(json.model).toBe("m1");
  });
  it("上限超は 413", async () => {
    const res = await post({
      language: "en",
      utterances: [{ id: "u1", track: null, startMs: 0, text: "a".repeat(60_001) }],
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("INPUT_TOO_LARGE");
  });
  it("language 不正は 400", async () => {
    const res = await post({ language: "fr", utterances: [] });
    expect(res.status).toBe(400);
  });
});
