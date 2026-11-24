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
const getMCPTools = vi.fn(async (servers: unknown[]) =>
  servers.length === 0
    ? { tools: {}, toolInfo: {}, errors: [] }
    : {
        tools: { "tavily-extract": {}, "tavily-search": {} },
        toolInfo: { "tavily-extract": { serverName: "Tavily" }, "tavily-search": { serverName: "Tavily" } },
        errors: [],
      },
);
vi.mock("../services/mcp.js", () => ({ getMCPTools: (...a: unknown[]) => (getMCPTools as (...x: unknown[]) => unknown)(...a) }));
const toolsNeedingApproval = vi.fn(() => [] as string[]);
vi.mock("../services/tool-approval.js", async (orig) => {
  const mod = await orig<typeof import("../services/tool-approval.js")>();
  return { ...mod, toolsNeedingApproval: (...a: unknown[]) => (toolsNeedingApproval as (...x: unknown[]) => string[])(...a) };
});

import app, { HELP_GROUNDING_INSTRUCTION, MATERIAL_AS_DATA_GUARD } from "./agent.js";

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
    getMCPTools.mockClear();
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

  describe("使い方（grounding_scope: help）", () => {
    const servers = [{ id: "t", type: "remote", name: "Tavily", url: "https://mcp.tavily.com/mcp", transport: "streamable-http" }];

    it("使い方の指示とマニュアルの節が入り、スキル・ナレッジの案内は入らない", async () => {
      const res = await post(
        { "X-MCP-Servers": JSON.stringify(servers) },
        { grounding_scope: "help", wiki_context: "<graphium-manual>[M1] X</graphium-manual>", custom_instructions: "SKILL-VOICE" },
      );
      expect(res.status).toBe(200);
      const prompt = runAgentLoop.mock.calls[0][0].systemPrompt as string;
      expect(prompt).toContain(HELP_GROUNDING_INSTRUCTION);
      expect(prompt).toContain("<graphium-manual>[M1] X</graphium-manual>");
      expect(prompt).not.toContain("SKILL-VOICE");
      expect(prompt).not.toContain("schema");
    });

    it("MCP の道具に繋がず、道具なしで答えさせる", async () => {
      await post({ "X-MCP-Servers": JSON.stringify(servers) }, { grounding_scope: "help" });
      expect(getMCPTools).toHaveBeenCalledWith([]);
      expect(runAgentLoop.mock.calls[0][0].tools).toEqual({});
    });

    it("ほかの範囲では使い方の指示を入れない", async () => {
      await post({}, { grounding_scope: "internal", custom_instructions: "SKILL-VOICE" });
      const prompt = runAgentLoop.mock.calls[0][0].systemPrompt as string;
      expect(prompt).not.toContain(HELP_GROUNDING_INSTRUCTION);
      expect(prompt).toContain("SKILL-VOICE");
      // 上の「schema が入らない」が空振りでないことの裏づけ（通常はナレッジの案内に入る）
      expect(prompt).toContain("schema");
    });
  });
});
