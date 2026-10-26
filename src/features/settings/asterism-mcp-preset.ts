// 「Asterism と連携する」preset。
//
// Asterism（知識グラフの作業台）は、起動中のアプリ本体が固定ポートに /mcp を出す
// （デスクトップ版は 8765、asterism-local は 8080。Asterism の ADR
// mcp-endpoint-on-the-app.md）。利用者に URL を貼らせず、候補を順に握手して最初に
// 答えたものを手動登録の 1 件（名前 "asterism"・streamable-http）として足す。
// 握手そのものは設定画面の「接続テスト」と同じ口（POST /mcp/test）を使う。

import type { McpServerEntry } from "./store";

/** 登録するサーバー名。既にこの名前があれば preset は出さない */
export const ASTERISM_MCP_SERVER_NAME = "asterism";

/** 探す順。デスクトップ版（8765）を先に、asterism-local（8080）を次に */
export const ASTERISM_MCP_CANDIDATE_URLS = [
  "http://127.0.0.1:8765/mcp",
  "http://127.0.0.1:8080/mcp",
] as const;

export function buildAsterismMcpEntry(url: string, id: string): McpServerEntry {
  return {
    type: "remote",
    id,
    name: ASTERISM_MCP_SERVER_NAME,
    url,
    transport: "streamable-http",
    enabled: true,
  };
}

export function hasAsterismMcpServer(servers: readonly McpServerEntry[]): boolean {
  return servers.some((s) => s.name === ASTERISM_MCP_SERVER_NAME);
}

/**
 * 候補を順に握手し、最初に答えたものを返す。`probe` は握手が通れば道具の数、
 * 通らなければ null を返す（例外は投げない）。どれも答えなければ null。
 */
export async function findReachableAsterism(
  probe: (entry: McpServerEntry) => Promise<number | null>,
  options: { candidates?: readonly string[]; newId?: () => string } = {},
): Promise<{ entry: McpServerEntry; toolCount: number } | null> {
  const candidates = options.candidates ?? ASTERISM_MCP_CANDIDATE_URLS;
  const newId = options.newId ?? (() => crypto.randomUUID());
  for (const url of candidates) {
    const entry = buildAsterismMcpEntry(url, newId());
    const toolCount = await probe(entry);
    if (toolCount !== null) return { entry, toolCount };
  }
  return null;
}
