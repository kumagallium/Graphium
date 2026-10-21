import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/llm.js", () => ({ createModel: vi.fn(async () => ({})) }));
vi.mock("../services/header-model.js", () => ({
  resolveModelConfig: vi.fn(() => ({ modelId: "m1", provider: "openai" })),
}));
vi.mock("../services/mcp.js", () => ({ getMCPTools: vi.fn(async () => ({ tools: {}, errors: [] })) }));
vi.mock("../services/registry.js", () => ({
  fetchRegistryServers: vi.fn(async () => []),
  filterSkills: vi.fn(() => []),
  buildSkillPromptSection: vi.fn(() => ""),
  buildMCPUrl: vi.fn(),
  detectTransport: vi.fn(),
}));
vi.mock("../services/env.js", () => ({
  getRegistryUrl: vi.fn(() => ""),
  getRegistryKey: vi.fn(() => ""),
  getManualMcpServers: vi.fn(() => []),
}));
vi.mock("../services/agent-loop.js", () => ({ runAgentLoop: vi.fn() }));

import agent from "./agent.js";
import { runAgentLoop } from "../services/agent-loop.js";

const baseBody = { message: "hi", knowledge_schema: "schema" };
const postRun = (extra: Record<string, unknown>) =>
  agent.request("/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...baseBody, ...extra }),
  });

const okResult = { message: "answer", toolCalls: [], model: "m1", tokenUsage: { inputTokens: 1, outputTokens: 2 } };

async function readLines(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  vi.mocked(runAgentLoop).mockReset();
});

describe("POST /run client_tools", () => {
  it("client_tools 未指定は従来どおり JSON 応答", async () => {
    vi.mocked(runAgentLoop).mockResolvedValueOnce(okResult as never);
    const res = await postRun({});
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.message).toBe("answer");
    const params = vi.mocked(runAgentLoop).mock.calls[0][0];
    expect(params.maxSteps).toBe(10);
    expect(params.systemPrompt).not.toContain("Searching the user's Graphium");
  });

  it("未知の名前だけなら JSON 応答のまま", async () => {
    vi.mocked(runAgentLoop).mockResolvedValueOnce(okResult as never);
    const res = await postRun({ client_tools: ["unknown"] });
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("NDJSON: run → tool_request → tool-result → result", async () => {
    vi.mocked(runAgentLoop).mockImplementationOnce((async (params: { tools: Record<string, any> }) => {
      const out = await params.tools.search_my_knowledge.execute({ query: "q" }, {});
      return { ...okResult, message: `got:${out}` };
    }) as never);

    const res = await postRun({ client_tools: ["search_my_knowledge"], options: { max_turns: 3 } });
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const lines: Array<Record<string, any>> = [];
    let answered = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line) continue;
        const obj = JSON.parse(line);
        lines.push(obj);
        if (obj.type === "tool_request" && !answered) {
          answered = true;
          const r = await agent.request("/run/tool-result", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ run_id: obj.run_id, call_id: obj.call_id, output: "RESULT" }),
          });
          expect(r.status).toBe(204);
        }
      }
    }
    expect(lines[0].type).toBe("run");
    expect(lines.map((l) => l.type)).toEqual(["run", "tool_request", "result"]);
    expect(lines[2].message).toBe("got:RESULT");
    const params = vi.mocked(runAgentLoop).mock.calls[0][0];
    expect(params.maxSteps).toBe(8);
    expect(params.systemPrompt).toContain("Searching the user's Graphium");
  });

  it("失敗時は error 行で閉じる", async () => {
    vi.mocked(runAgentLoop).mockRejectedValueOnce(new Error("kaboom"));
    const res = await postRun({ client_tools: ["read_my_page"] });
    const lines = await readLines(res);
    expect(lines[lines.length - 1]).toMatchObject({ type: "error", error: "kaboom" });
  });
});

describe("POST /run/tool-result", () => {
  it("待っていない call_id は 404", async () => {
    const res = await agent.request("/run/tool-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: "r", call_id: "c", output: "x" }),
    });
    expect(res.status).toBe(404);
  });
  it("run_id なしは 400", async () => {
    const res = await agent.request("/run/tool-result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
