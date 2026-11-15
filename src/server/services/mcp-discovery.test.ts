import { afterEach, describe, expect, it, vi } from "vitest";

const fetchRegistryServers = vi.fn(async (_url: string, _key: string) => [
  { name: "search", tool_type: "mcp_server", status: "running" },
]);
vi.mock("./registry.js", () => ({
  fetchRegistryServers: (url: string, key: string) => fetchRegistryServers(url, key),
  buildMCPUrl: (_s: unknown, base: string) => `${base}/mcp`,
  detectTransport: () => "streamable-http",
}));
vi.mock("./mcp.js", () => ({
  getMCPTools: vi.fn(async () => ({ tools: {}, toolInfo: {} })),
}));

import { discoverAllMcpTools } from "./mcp-discovery.js";

function ctx(headers: Record<string, string>) {
  return { req: { header: (n: string) => headers[n] } } as never;
}

describe("discoverAllMcpTools（世界照合の運用側 Registry）", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    fetchRegistryServers.mockClear();
  });

  it("X-Registry-URL ヘッダーだけでは Registry に接続せず、運用側サーバーも空", async () => {
    vi.stubEnv("CRUCIBLE_API_URL", "");
    const r = await discoverAllMcpTools(ctx({ "X-Registry-URL": "https://evil.example" }));
    expect(fetchRegistryServers).not.toHaveBeenCalled();
    expect(r.operatorServers.size).toBe(0);
  });

  it("環境変数があればヘッダーを無視して環境変数の Registry を使う", async () => {
    vi.stubEnv("CRUCIBLE_API_URL", "https://ops.example/");
    const r = await discoverAllMcpTools(ctx({ "X-Registry-URL": "https://evil.example" }));
    expect(fetchRegistryServers.mock.calls[0][0]).toBe("https://ops.example");
    expect([...r.operatorServers]).toEqual(["search"]);
  });
});
