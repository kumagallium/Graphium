import { describe, expect, it } from "vitest";
import { buildChatMcpHeaderValue, buildGroundingMcpHeaderValue } from "./mcp-servers-header";
import type { McpServerEntry } from "./store";

const remote = (o: Partial<Extract<McpServerEntry, { type: "remote" }>> = {}): McpServerEntry => ({
  id: "r1",
  type: "remote",
  name: "Tavily",
  url: "https://mcp.tavily.com/mcp/",
  transport: "streamable-http",
  apiKey: "tvly-secret",
  enabled: true,
  approvalFreeTools: ["tavily-search", "tavily_search"],
  ...o,
});
const stdio = (o: Partial<Extract<McpServerEntry, { type: "stdio" }>> = {}): McpServerEntry => ({
  id: "s1",
  type: "stdio",
  name: "Local",
  command: "npx",
  args: ["-y", "x"],
  enabled: true,
  approvalFreeTools: ["x_search"],
  ...o,
});

describe("buildGroundingMcpHeaderValue（世界照合に送るサーバー）", () => {
  it("approvalFreeTools を持つ有効な remote だけが入り、形はチャットと揃う", () => {
    const v = buildGroundingMcpHeaderValue([remote()]);
    expect(JSON.parse(v!)).toEqual([
      {
        id: "r1",
        type: "remote",
        name: "Tavily",
        url: "https://mcp.tavily.com/mcp/",
        transport: "streamable-http",
        apiKey: "tvly-secret",
        approvalFreeTools: ["tavily-search", "tavily_search"],
      },
    ]);
  });

  it("厳選一覧に当たらない URL のサーバーは、approvalFreeTools があっても入らない", () => {
    expect(buildGroundingMcpHeaderValue([remote({ url: "https://evil.example.com/mcp", approvalFreeTools: ["search"] })])).toBeNull();
  });

  it("送る道具名は一覧との共通部分だけ（一覧外の名前は落とす）。共通が無ければ入らない", () => {
    const v = buildGroundingMcpHeaderValue([remote({ approvalFreeTools: ["tavily_search", "tavily_crawl"] })]);
    expect(JSON.parse(v!)[0].approvalFreeTools).toEqual(["tavily_search"]);
    expect(buildGroundingMcpHeaderValue([remote({ approvalFreeTools: ["tavily_crawl"] })])).toBeNull();
  });

  it("stdio・無効・approvalFreeTools 無し・skipApproval だけ、は入らない", () => {
    const v = buildGroundingMcpHeaderValue([
      stdio(),
      remote({ id: "r2", enabled: false }),
      remote({ id: "r3", approvalFreeTools: undefined }),
      remote({ id: "r4", approvalFreeTools: undefined, skipApproval: true }),
      remote({ id: "r5", approvalFreeTools: [] }),
    ]);
    expect(v).toBeNull();
  });

  it("skipApproval は載らない（サーバー丸ごと免除にならない）", () => {
    const v = buildGroundingMcpHeaderValue([remote({ skipApproval: true })]);
    expect(JSON.parse(v!)[0]).not.toHaveProperty("skipApproval");
  });

  it("非 ASCII の名前でもヘッダーに使える（ASCII のみ・復元できる）", () => {
    const v = buildGroundingMcpHeaderValue([remote({ name: "検索サーバー" })])!;
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(v)).toBe(true);
    expect(JSON.parse(v)[0].name).toBe("検索サーバー");
  });
});

describe("buildChatMcpHeaderValue（チャット用・従来どおり）", () => {
  it("stdio も skipApproval も載る。空なら null", () => {
    expect(buildChatMcpHeaderValue([])).toBeNull();
    const parsed = JSON.parse(buildChatMcpHeaderValue([stdio(), remote({ skipApproval: true })])!);
    expect(parsed[0]).toMatchObject({ type: "stdio", command: "npx" });
    expect(parsed[1].skipApproval).toBe(true);
  });
});
