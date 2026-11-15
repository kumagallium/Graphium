// /api/agent/run が組む system プロンプトに「資料はデータ」の文が入ること、
// 確認の免除（approvalFreeTools）が toolsNeedingApproval に渡ることの結合試験。
// LLM・MCP は差し替える（外部へは出ない）。

import { beforeEach, describe, expect, it, vi } from "vitest";

const runAgentLoop = vi.fn();
vi.mock("../services/agent-loop.js", () => ({ runAgentLoop: (...a: unknown[]) => runAgentLoop(...a) }));
vi.mock("../services/llm.js", () => ({ createModel: async () => ({}) }));
vi.mock("../services/header-model.js", () => ({
  resolveModelConfig: () => ({ provider: "openai", modelId: "m", apiKey: "k", name: "m" }),
}));
vi.mock("../services/mcp.js", () => ({
  getMCPTools: async () => ({
    tools: { "tavily-extract": {}, "tavily-search": {} },
    toolInfo: { "tavily-extract": { serverName: "Tavily" }, "tavily-search": { serverName: "Tavily" } },
    errors: [],
  }),
}));
const toolsNeedingApproval = vi.fn(() => [] as string[]);
vi.mock("../services/tool-approval.js", async (orig) => {
  const mod = await orig<typeof import("../services/tool-approval.js")>();
  return { ...mod, toolsNeedingApproval: (...a: unknown[]) => (toolsNeedingApproval as (...x: unknown[]) => string[])(...a) };
});

import app, { MATERIAL_AS_DATA_GUARD } from "./agent.js";

function post(headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return app.request("/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ message: "hi", knowledge_schema: "schema", ...extra }),
  });
}

describe("POST /run", () => {
  beforeEach(() => {
    runAgentLoop.mockReset();
    runAgentLoop.mockResolvedValue({ message: "ok", toolCalls: [], tokenUsage: {}, model: "m" });
    toolsNeedingApproval.mockClear();
  });

  it("system プロンプトに MATERIAL_AS_DATA_GUARD が入る", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(runAgentLoop.mock.calls[0][0].systemPrompt).toContain(MATERIAL_AS_DATA_GUARD);
  });

  it("X-MCP-Servers の approvalFreeTools が toolsNeedingApproval に渡る", async () => {
    const servers = [
      { id: "t", type: "remote", name: "Tavily", url: "https://mcp.tavily.com/mcp", transport: "streamable-http", approvalFreeTools: ["tavily-search"] },
    ];
    await post({ "X-MCP-Servers": JSON.stringify(servers) }, { tool_approval: true });
    expect(toolsNeedingApproval).toHaveBeenCalled();
    const call = toolsNeedingApproval.mock.calls[0] as unknown as unknown[];
    const freeTools = call[3] as Map<string, Set<string>> | Record<string, string[]> | undefined;
    expect(JSON.stringify(freeTools instanceof Map ? [...freeTools.entries()].map(([k, v]) => [k, [...(v as Set<string>)]]) : freeTools)).toContain("tavily-search");
  });
});
