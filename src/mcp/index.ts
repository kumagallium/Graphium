#!/usr/bin/env node
// Graphium MCP サーバー（stdio）。
//
// Claude Desktop / Claude Code から Graphium の vault を読み書きするための入口。
// 読む・ノートを足すことは **Graphium アプリの起動に依存しない** — vault のファイルを直接読むため、
// アプリが落ちていても、そもそもインストールしていないマシンでも、vault さえあれば動く。
// ナレッジのページの書き換え（手入れ。upkeep/）はアプリが起動中だと断る（upkeep/guard.ts）。
// 例外: トピックと知見の保存（submit_topic_page / submit_claims / submit_rewrite）は起動中でも通り、
// Graphium で開いているページだけ書き換えない（知らせファイルでアプリに伝える）。
//
// ⚠️ stdout は JSON-RPC 専用。console.log を足すとプロトコルが壊れて
//    クライアント側で「サーバーが応答しない」になる。ログは必ず stderr へ。

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAppTools } from "./app-tools";
import { installExitWhenReplaced } from "./exit-when-replaced";
import { createGraphiumMcpServer } from "./create-server";
import { registerClaimTools } from "./claim-tools";
import { registerInsightTools } from "./insight-tools";
import { registerMediaTools } from "./media-tools";
import { registerMaterialOfferTool } from "./material-offer";
import { registerProcedureTools } from "./procedure-tools";
import { registerTopicTools } from "./topic-tools";
import { registerReadTools } from "./read-tools";
import { registerTools, type ToolContext } from "./tools";
import { cleanupTempFiles } from "./upkeep/cleanup";
import { createMcpUsageRecorder } from "./usage-recorder";
import { createFileActivityLog } from "./activity";
import { registerUpkeepTools } from "./upkeep/tools";
import { registerSourceDateTool } from "./upkeep/source-date";
import { appDataDir, resolveGraphiumRoot, vaultExists } from "./vault";

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

  const server = createGraphiumMcpServer(VERSION);

  // initialize は connect 直後にはまだ終わっていないので、呼ばれた時点で解決する
  const getClientName = () => {
    try {
      return server.server.getClientVersion()?.name;
    } catch {
      // 取れなくても動作に支障はない（来歴の agent 名が粗くなるだけ）
      return undefined;
    }
  };
  // このプロセスの中で触れたもの（全体グラフの画面が光らせる）。読んだ記録はこれにも積む
  // 触れた記録は appdata のファイルに書く（画面の問い合わせが別の MCP プロセスに届いても読めるように）
  const activity = createFileActivityLog(() => appDataDir(resolveGraphiumRoot()));
  const recorder = createMcpUsageRecorder({ getClientName });
  const ctx: ToolContext = {
    getClientName,
    // 外の AI にページが読まれたことを appdata に記録する（このプロセス専用のファイル）
    usage: {
      session: recorder.session,
      recordRead(id, opts) {
        activity.push("read", id);
        return recorder.recordRead(id, opts);
      },
    },
    activity,
  };
  registerTools(server, ctx);
  registerReadTools(server, ctx);
  registerUpkeepTools(server, ctx);
  registerSourceDateTool(server, ctx);
  registerClaimTools(server, ctx);
  registerInsightTools(server, ctx);
  registerProcedureTools(server, ctx);
  registerTopicTools(server, ctx);
  registerMediaTools(server);
  registerMaterialOfferTool(server, ctx);
  // 会話の中に画面を描く道具（MCP Apps）。対応していないクライアントには文字の結果だけが届く
  registerAppTools(server, ctx);

  const transport = new StdioServerTransport();
  // アプリの更新で自分のファイルが差し替えられたら、処理中の要求が無いときに終える。
  // 開いたままのセッションが古い版を使い続けて、古いプロセスが溜まるのを防ぐ
  installExitWhenReplaced(transport, {
    scriptPath: process.argv[1],
    exit: (reason) => exitAfterFlush(`差し替えを検知（${reason}）`),
  });
  // クライアントが閉じた（標準入力が閉じた）ら終える。親が消えたあとに残らないように
  process.stdin.once("end", () => exitAfterFlush("標準入力が閉じた"));
  process.stdin.once("close", () => exitAfterFlush("標準入力が閉じた"));

  await server.connect(transport);
}

/** 書きかけの応答を stdout に出し切ってから終える（macOS のパイプは非同期書き込み） */
function exitAfterFlush(why: string): void {
  process.stderr.write(`[graphium-mcp] 終了: ${why}\n`);
  process.stdout.write("", () => process.exit(0));
}

main().catch((err) => {
  process.stderr.write(`[graphium-mcp] fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
