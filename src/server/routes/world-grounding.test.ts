// 世界照合ルートの結合テスト: X-MCP-Servers で来た厳選の検索サーバーを、
// プロセス内に立てた本物の streamable-http の MCP サーバーに繋いで確かめる。
// モックするのは LLM 呼び出しと Wikipedia / OpenAlex だけ。

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const runAgentLoop = vi.fn();
vi.mock("../services/llm.js", () => ({ createModel: vi.fn(async () => ({})) }));
vi.mock("../services/header-model.js", () => ({
  resolveModelConfig: () => ({ provider: "openai", modelId: "test", apiKey: "k" }),
}));
vi.mock("../services/agent-loop.js", () => ({
  runAgentLoop: (opts: unknown) => runAgentLoop(opts),
}));
vi.mock("../services/grounding-providers.js", () => ({
  runBuiltinGroundingSearch: vi.fn(async () => ({ evidenceText: "", urls: [] })),
}));

import app, { setDiscoveryTimeoutForTest } from "./world-grounding.js";

const calls: { tool: string; args: Record<string, unknown> }[] = [];
let failSearch = false;
// 失敗時のエラー文（URL やキーを含む文でも根拠にならないことを確かめるために差し替える）
let failMessage = "invalid api key";
// true にすると tools/list に答えない（握手だけ返して黙る検索サーバー）
let hangOnList = false;
let httpServer: Server;
let baseUrl = "";

function buildMcp(): McpServer {
  const mcp = new McpServer({ name: "fake-tavily", version: "1.0.0" });
  const reg = (name: string, text: (a: Record<string, unknown>) => string) =>
    mcp.registerTool(name, { description: name, inputSchema: { query: z.string() } }, async (args) => {
      calls.push({ tool: name, args: args as Record<string, unknown> });
      if (failSearch) throw new Error(failMessage);
      return { content: [{ type: "text" as const, text: text(args as Record<string, unknown>) }] };
    });
  reg("tavily_search", (a) => `result for ${String(a.query)}: https://example.com/evidence`);
  reg("tavily_extract", () => "https://example.com/extracted");
  reg("tavily_crawl", () => "https://example.com/crawled");
  return mcp;
}

beforeAll(async () => {
  httpServer = createServer(async (req, res) => {
    const mcp = buildMcp();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    // 本文を先に読み、tools/list に答えない検索サーバーを再現できるようにする
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {
      parsed = undefined;
    }
    if (hangOnList && (parsed as { method?: string } | undefined)?.method === "tools/list") return; // 応答しない
    await transport.handleRequest(req, res, parsed);
  });
  await new Promise<void>((r) => httpServer.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/mcp`;
});
afterAll(async () => {
  httpServer.closeAllConnections?.();
  await new Promise<void>((r) => httpServer.close(() => r()));
});

beforeEach(() => {
  calls.length = 0;
  failSearch = false;
  failMessage = "invalid api key";
  hangOnList = false;
  runAgentLoop.mockReset();
  runAgentLoop.mockResolvedValue({
    message: JSON.stringify({ verdict: "established", rationale: "ok", sources: [{ ref: "e", url: "https://example.com/evidence" }] }),
    model: "test",
    tokenUsage: {},
  });
});

let seq = 0;
async function check(servers: unknown[]) {
  // プールの取り違えを避けるため、テストごとに別の id にする
  const withIds = servers.map((s, i) => ({ id: `t${++seq}-${i}`, ...(s as object) }));
  const res = await app.request("/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-MCP-Servers": JSON.stringify(withIds) },
    body: JSON.stringify({ claimText: "water boils at 100 C", language: "en" }),
  });
  return res.json() as Promise<{ result: unknown; grounded: boolean; error?: string }>;
}

const curated = (tools: string[]) => ({
  type: "remote",
  name: "Tavily",
  url: baseUrl,
  transport: "streamable-http",
  approvalFreeTools: tools,
});

describe("POST /world-grounding/check と X-MCP-Servers（厳選の検索サーバー）", () => {
  it("厳選の検索道具が 1 回だけ実行され、根拠に入る", async () => {
    const json = await check([curated(["tavily-search", "tavily_search"])]);
    expect(calls.map((c) => c.tool)).toEqual(["tavily_search"]);
    expect(calls[0].args.query).toBe("water boils at 100 C");
    expect(json.grounded).toBe(true);
    const userMsg = JSON.stringify(runAgentLoop.mock.calls[0][0]);
    expect(userMsg).toContain("https://example.com/evidence");
    expect(userMsg).toContain("Web search: tavily_search");
  });

  it("approvalFreeTools に無い道具（extract など）しか無いときは何も実行しない", async () => {
    const json = await check([curated(["tavily_extract_not_listed"])]);
    expect(calls).toEqual([]);
    expect(json.grounded).toBe(false);
  });

  it("一覧に載せた tavily_crawl / tavily_extract は、名前に tavily を含んでいても実行しない", async () => {
    const json = await check([curated(["tavily_crawl", "tavily_extract"])]);
    expect(calls).toEqual([]);
    expect(json.grounded).toBe(false);
  });

  it("検索と crawl が両方載っていても、実行されるのは検索だけ", async () => {
    await check([curated(["tavily_crawl", "tavily_search"])]);
    expect(calls.map((c) => c.tool)).toEqual(["tavily_search"]);
  });

  it("approvalFreeTools を持たないサーバーは、名前が検索らしくても実行しない", async () => {
    const { approvalFreeTools: _drop, ...noList } = curated([]);
    const json = await check([{ ...noList, skipApproval: true }]);
    expect(calls).toEqual([]);
    expect(json.grounded).toBe(false);
  });

  it("検索が失敗しても照合は続く（根拠なしの判定にフォールバック）", async () => {
    failSearch = true;
    const json = await check([curated(["tavily_search"])]);
    expect(calls.length).toBe(1);
    expect(json.result).not.toBeNull();
    expect(json.grounded).toBe(false);
  });

  it("エラー応答の本文（URL やキーを含む）は根拠にも出典にもならない", async () => {
    failSearch = true;
    failMessage = "Unauthorized: invalid key (Bearer tvly-SECRET) see https://docs.example.com/errors";
    const json = await check([curated(["tavily_search"])]);
    expect(calls.length).toBe(1);
    expect(json.result).not.toBeNull();
    expect(json.grounded).toBe(false);
    const sent = JSON.stringify(runAgentLoop.mock.calls[0][0]);
    expect(sent).not.toContain("tvly-SECRET");
    expect(sent).not.toContain("docs.example.com");
    expect(sent).not.toContain("Web search:");
  });

  it("検索サーバーが tools/list に答えなくても、上限で切り上げて照合を続ける", async () => {
    hangOnList = true;
    setDiscoveryTimeoutForTest(300);
    try {
      const started = Date.now();
      const json = await check([curated(["tavily_search"])]);
      expect(Date.now() - started).toBeLessThan(5000);
      expect(calls).toEqual([]);
      expect(json.result).not.toBeNull();
      expect(json.grounded).toBe(false);
    } finally {
      setDiscoveryTimeoutForTest();
    }
  });
});
