// getManualMcpServers が確認の免除（approvalFreeTools）を読むことのテスト

import { describe, expect, it } from "vitest";
import type { Context } from "hono";

import { getManualMcpServers } from "./env";

const ctxWith = (servers: unknown) => ({ req: { header: (n: string) => (n === "X-MCP-Servers" ? JSON.stringify(servers) : undefined) } }) as unknown as Context;

describe("getManualMcpServers", () => {
  it("approvalFreeTools は文字列だけを読む", () => {
    const [s] = getManualMcpServers(
      ctxWith([{ id: "t", type: "remote", name: "tavily", url: "https://mcp.tavily.com/mcp/", approvalFreeTools: ["tavily-search", 3, ""] }]),
    );
    expect(s.approvalFreeTools).toEqual(["tavily-search"]);
    expect(s.skipApproval).toBeUndefined();
  });
  it("無ければ付けない", () => {
    const [s] = getManualMcpServers(ctxWith([{ id: "t", type: "remote", name: "x", url: "https://x.example/mcp" }]));
    expect(s.approvalFreeTools).toBeUndefined();
  });
});
