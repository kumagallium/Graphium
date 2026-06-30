// リクエストヘッダー由来の MCP サーバーをまとめて接続し、利用可能なツールを返す。
//
// agent.ts のチャット用ツール収集と同じ供給源（手動登録 + 環境変数 Registry 既定）を
// 使うが、server_names / disabled_tools の絞り込みは行わない。世界照合は「検索ツールを
// 1 つ見つける」のが目的で、チャットのような per-request 許可リストを持たないため。

import type { Context } from "hono";
import { fetchRegistryServers, buildMCPUrl, detectTransport } from "./registry.js";
import { getMCPTools, type MCPServerInfo } from "./mcp.js";
import { getRegistryUrl, getRegistryKey, getManualMcpServers } from "./env.js";

/**
 * 接続可能な MCP サーバー全ての tools を集約して返す。
 * MCP が一切設定されていなければ即座に空で返す（無駄なネットワーク往復を避ける）。
 * 接続失敗したサーバーは getMCPTools 側で graceful にスキップされる。
 */
export async function discoverAllMcpTools(
  c: Context,
): Promise<{ tools: Record<string, unknown> }> {
  const manualServers = getManualMcpServers(c);
  const envRegistryUrl = getRegistryUrl(c).replace(/\/$/, "");
  if (manualServers.length === 0 && !envRegistryUrl) return { tools: {} };

  const envRegistryServers = envRegistryUrl
    ? await fetchRegistryServers(envRegistryUrl, getRegistryKey())
    : [];

  // (1) Crucible Registry 由来（running な mcp_server のみ）。すべて remote 接続。
  const registryEndpoints: MCPServerInfo[] = envRegistryServers
    .filter((s) => s.tool_type === "mcp_server" && s.status === "running")
    .map((s) => ({
      id: `registry:${envRegistryUrl}:${s.name}`,
      type: "remote",
      name: s.name,
      url: buildMCPUrl(s, envRegistryUrl),
      transport: detectTransport(s),
    }));

  // (2) ユーザーが直接登録した MCP サーバー（stdio / remote）。
  const manualEndpoints: MCPServerInfo[] = manualServers.map((s): MCPServerInfo =>
    s.type === "stdio"
      ? { id: s.id, type: "stdio", name: s.name, command: s.command, args: s.args, env: s.env }
      : { id: s.id, type: "remote", name: s.name, url: s.url, transport: s.transport, apiKey: s.apiKey },
  );

  // (1) ∪ (2)。同名は手動登録を優先（ユーザーの明示指定を尊重）。
  const byName = new Map<string, MCPServerInfo>();
  for (const e of registryEndpoints) byName.set(e.name, e);
  for (const e of manualEndpoints) byName.set(e.name, e);

  return getMCPTools([...byName.values()]);
}
