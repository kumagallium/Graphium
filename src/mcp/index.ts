#!/usr/bin/env node
// Graphium MCP サーバー（stdio）。
//
// Claude Desktop / Claude Code から Graphium の vault を読み書きするための入口。
// **Graphium アプリの起動には依存しない** — vault のファイルを直接読むため、
// アプリが落ちていても、そもそもインストールしていないマシンでも、vault さえあれば動く。
//
// ⚠️ stdout は JSON-RPC 専用。console.log を足すとプロトコルが壊れて
//    クライアント側で「サーバーが応答しない」になる。ログは必ず stderr へ。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./tools";
import { resolveGraphiumRoot, vaultExists } from "./vault";

/** bundle 時に esbuild の --define で埋め込む。dev 実行では既定値のまま */
declare const __GRAPHIUM_VERSION__: string | undefined;
const VERSION = typeof __GRAPHIUM_VERSION__ === "string" ? __GRAPHIUM_VERSION__ : "0.0.0-dev";

async function main(): Promise<void> {
  const root = resolveGraphiumRoot();
  // 起動時の状況は stderr に出す。クライアントのログに残って切り分けが楽になる
  process.stderr.write(`[graphium-mcp] v${VERSION} vault=${root} exists=${vaultExists(root)}\n`);

  const server = new McpServer({ name: "graphium", version: VERSION });

  registerTools(server, {
    // initialize は connect 直後にはまだ終わっていないので、呼ばれた時点で解決する
    getClientName: () => {
      try {
        return server.server.getClientVersion()?.name;
      } catch {
        // 取れなくても動作に支障はない（来歴の agent 名が粗くなるだけ）
        return undefined;
      }
    },
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[graphium-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
