import { beforeEach, describe, expect, it, vi } from "vitest";

const servers = vi.fn();
vi.mock("../../lib/platform", () => ({ apiBase: () => "/api", isTauri: () => true }));
vi.mock("../settings/store", () => ({
  getEnabledMcpServers: () => servers(),
  getGroundingLLMModel: () => null,
  getGroundingModelName: () => "m",
  isAgentConfigured: () => true,
}));

import { buildHeaders } from "./llm-fallback";

describe("世界照合の要求ヘッダー", () => {
  beforeEach(() => servers.mockReset());

  it("厳選の検索サーバーだけを X-MCP-Servers に載せる", () => {
    servers.mockReturnValue([
      { id: "a", type: "remote", name: "Tavily", url: "https://mcp.tavily.com/mcp/", transport: "streamable-http", enabled: true, approvalFreeTools: ["tavily_search"] },
      { id: "b", type: "stdio", name: "L", command: "npx", args: [], enabled: true },
      { id: "c", type: "remote", name: "Other", url: "https://y/mcp", transport: "sse", enabled: true, skipApproval: true },
    ]);
    const h = buildHeaders();
    expect(JSON.parse(h["X-MCP-Servers"]).map((s: { name: string }) => s.name)).toEqual(["Tavily"]);
  });

  it("該当が無ければヘッダー自体を付けない", () => {
    servers.mockReturnValue([{ id: "c", type: "remote", name: "Other", url: "https://y/mcp", transport: "sse", enabled: true }]);
    expect(buildHeaders()).not.toHaveProperty("X-MCP-Servers");
  });
});
