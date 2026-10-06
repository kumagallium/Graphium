#!/usr/bin/env node
// Graphium MCP サーバー（stdio）。
//
// Claude Desktop / Claude Code から Graphium の vault を読み書きするための入口。
// 読む・ノートを足すことは **Graphium アプリの起動に依存しない** — vault のファイルを直接読むため、
// アプリが落ちていても、そもそもインストールしていないマシンでも、vault さえあれば動く。
// ナレッジのページの書き換え（手入れ。upkeep/）はアプリが起動中だと断る（upkeep/guard.ts）。
//
// ⚠️ stdout は JSON-RPC 専用。console.log を足すとプロトコルが壊れて
//    クライアント側で「サーバーが応答しない」になる。ログは必ず stderr へ。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerReadTools } from "./read-tools";
import { registerTools, type ToolContext } from "./tools";
import { cleanupTempFiles } from "./upkeep/cleanup";
import { registerUpkeepTools } from "./upkeep/tools";
import { resolveGraphiumRoot, vaultExists } from "./vault";

/** bundle 時に esbuild の --define で埋め込む。dev 実行では既定値のまま */
declare const __GRAPHIUM_VERSION__: string | undefined;
const VERSION = typeof __GRAPHIUM_VERSION__ === "string" ? __GRAPHIUM_VERSION__ : "0.0.0-dev";

async function main(): Promise<void> {
  const root = resolveGraphiumRoot();
  // 起動時の状況は stderr に出す。クライアントのログに残って切り分けが楽になる
  process.stderr.write(`[graphium-mcp] v${VERSION} vault=${root} exists=${vaultExists(root)}\n`);
  // 原子的な書き込みの途中で落ちた一時ファイルの残骸を片付ける（失敗しても起動は続ける）
  await cleanupTempFiles(root).catch((e) => {
    process.stderr.write(`[graphium-mcp] 一時ファイルの片付けに失敗: ${String(e)}\n`);
  });

  const server = new McpServer({ name: "graphium", version: VERSION });

  const ctx: ToolContext = {
    // initialize は connect 直後にはまだ終わっていないので、呼ばれた時点で解決する
    getClientName: () => {
      try {
        return server.server.getClientVersion()?.name;
      } catch {
        // 取れなくても動作に支障はない（来歴の agent 名が粗くなるだけ）
        return undefined;
      }
    },
  };
  registerTools(server, ctx);
  registerReadTools(server, ctx);
  registerUpkeepTools(server, ctx);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[graphium-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
