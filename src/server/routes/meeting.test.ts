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

describe("POST /cleanup", () => {
  const postCleanup = (body: unknown) =>
    meeting.request("/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("段落を返す（読めない出力は 502）", async () => {
    const { runAgentLoop } = await import("../services/agent-loop.js");
    vi.mocked(runAgentLoop).mockResolvedValueOnce({
      message: JSON.stringify({
        topic: "t",
        fixes: [{ heard: "聖書", meant: "清書" }],
        paragraphs: [{ text: "決めました。", sources: ["u1", "bad"] }],
      }),
      model: "m1",
      tokenUsage: { inputTokens: 1, outputTokens: 2 },
    } as never);
    const res = await postCleanup({
      language: "ja",
      vocabulary: "Graphium",
      utterances: [{ id: "uuid-1", track: "mic", startMs: 0, text: "えー決めました" }],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.paragraphs).toEqual([{ text: "決めました。", sources: ["uuid-1"] }]);
    expect(json.fixes).toEqual([{ heard: "聖書", meant: "清書" }]);
    expect(json.model).toBe("m1");

    vi.mocked(runAgentLoop).mockResolvedValueOnce({ message: "no json", model: "m1" } as never);
    const bad = await postCleanup({
      language: "ja",
      utterances: [{ id: "a", track: null, startMs: 0, text: "x" }],
    });
    expect(bad.status).toBe(502);
  });
  it("上限超は 413", async () => {
    const res = await postCleanup({
      language: "en",
      utterances: [{ id: "u1", track: null, startMs: 0, text: "a".repeat(12_001) }],
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe("INPUT_TOO_LARGE");
  });
  it("発言 301 件は 413、language 不正は 400", async () => {
    const many = Array.from({ length: 301 }, (_, i) => ({ id: `x${i}`, track: null, startMs: 0, text: "a" }));
    expect((await postCleanup({ language: "ja", utterances: many })).status).toBe(413);
    expect((await postCleanup({ language: "fr", utterances: [] })).status).toBe(400);
  });
});
