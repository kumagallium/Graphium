// MCP サーバー本体（McpServer）の生成。index.ts の main() から切り出したもの。
// サーバー全体の説明文（instructions）を必ず渡す入口を 1 か所にし、テストでも同じ道を通す。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { SERVER_INSTRUCTIONS } from "./server-instructions";

export function createGraphiumMcpServer(version: string): McpServer {
  return new McpServer({ name: "graphium", version }, { instructions: SERVER_INSTRUCTIONS });
}
