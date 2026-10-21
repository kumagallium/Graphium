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

describe("名前などを伏せる（mask）", () => {
  const req = (path: string, body: unknown) =>
    meeting.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const utterances = [{ id: "uuid-1", track: "mic", startMs: 0, text: "田中です" }];

  it("清書: 指示に伏せる節を足し、返った文も機械で伏せて masked を返す", async () => {
    const { runAgentLoop } = await import("../services/agent-loop.js");
    vi.mocked(runAgentLoop).mockClear();
    vi.mocked(runAgentLoop).mockResolvedValueOnce({
      message: JSON.stringify({
        topic: "t",
        fixes: [{ heard: "たなか", meant: "田中" }],
        paragraphs: [{ text: "田中です。taro@example.com", sources: ["u1"] }],
      }),
      model: "m1",
    } as never);
    const json = await (await req("/cleanup", { language: "ja", utterances, mask: true, maskTerms: "田中" })).json();
    expect(json.paragraphs[0].text).toBe("［伏せ字］です。［連絡先］");
    expect(json.masked).toBe(true);
    // 直した語には生の名前が入りうるので返さない
    expect(json.fixes).toEqual([]);
    expect(vi.mocked(runAgentLoop).mock.calls[0][0].systemPrompt).toContain("Hide sensitive details");
  });

  it("要約: 本文・担当・期限を伏せる。mask でなければ触らない", async () => {
    const { runAgentLoop } = await import("../services/agent-loop.js");
    const reply = {
      message: JSON.stringify({
        decisions: [{ text: "田中が決めた", sources: ["u1"] }],
        todos: [{ text: "田中に連絡", owner: "田中", due: "金曜", sources: ["u1"] }],
        issues: [],
      }),
      model: "m1",
    };
    vi.mocked(runAgentLoop).mockResolvedValueOnce(reply as never);
    const masked = await (await req("/summarize", { language: "ja", utterances, mask: true, maskTerms: "田中" })).json();
    expect(masked.decisions[0].text).toBe("［伏せ字］が決めた");
    expect(masked.todos[0]).toMatchObject({ text: "［伏せ字］に連絡", owner: "［伏せ字］", due: "金曜" });
    expect(masked.masked).toBe(true);

    vi.mocked(runAgentLoop).mockResolvedValueOnce(reply as never);
    const plain = await (await req("/summarize", { language: "ja", utterances, maskTerms: "田中" })).json();
    expect(plain.todos[0].owner).toBe("田中");
    expect(plain.masked).toBe(false);
  });
});

describe("POST /context", () => {
  it("ローカルでないモデルは問い合わせず null", async () => {
    const res = await meeting.request("/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "x" }),
    });
    expect(await res.json()).toEqual({ loadedContext: null });
  });
});
