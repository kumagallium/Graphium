// Graphium バックエンドサーバー（Node.js 常駐プロセス用）
// デスクトップ（Tauri sidecar）・Docker で使用
// Vercel Serverless Functions では api/[[...route]].ts を使用

import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { setDataDir as setModelsDataDir } from "./config/models.js";
import { setDataDir as setProfilesDataDir } from "./config/profiles.js";
import { setUsageDataDir, retentionSweep } from "./services/llm-usage.js";
import { setSidecarIdentity } from "./routes/health.js";
import { createApp } from "./app.js";

// 起動段階を stderr に同期書きで残す（Tauri sidecar の Windows 経路で
// stdout/stderr が無音のまま hang する症状を切り分けるため）。
// console.log は内部でバッファされるが、process.stderr.write は
// pipe に対しても synchronous なので、確実に Tauri 側まで届く。
//
// stderr が pipe ごと届かないケース（Windows）に備え、bundle banner で
// 仕込んでいる sidecar-boot.log にも append する。
function bootLog(msg: string): void {
  try {
    process.stderr.write(`[server-boot] ${msg}\n`);
  } catch {
    // stderr が壊れている環境（テスト等）は無視
  }
  try {
    const append = (globalThis as unknown as { __BOOT_LOG_APPEND__?: (s: string) => void }).__BOOT_LOG_APPEND__;
    if (typeof append === "function") append(`server-boot ${msg}`);
  } catch {
    // ファイル書き出しエラーは無視（診断専用なので落とさない）
  }
}

bootLog("imports complete, resolving data dir");

// データディレクトリ設定（環境変数 or デフォルト）
// デスクトップアプリ（sidecar）では ~/Documents/Graphium/server-data を使用
import { homedir } from "node:os";
import { accessSync, constants as fsConstants } from "node:fs";

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const cwdData = join(process.cwd(), "data");
  // cwd が書き込み可能ならそのまま使う（dev モード / Docker）
  try {
    accessSync(process.cwd(), fsConstants.W_OK);
    return cwdData;
  } catch {
    // 書き込み不可（ビルド版アプリ）→ ユーザーのドキュメントフォルダ
    return join(homedir(), "Documents", "Graphium", "server-data");
  }
}
const dataDir = resolveDataDir();
bootLog(`dataDir=${dataDir}`);
console.log(`[server] Data directory: ${dataDir}`);
setModelsDataDir(dataDir);
setProfilesDataDir(dataDir);
setUsageDataDir(dataDir);
setSidecarIdentity({ pid: process.pid, dataDir });
bootLog("data dir config wired, creating app");

// 起動時に 90 日より古い raw event を月次サマリに集約する
try {
  retentionSweep();
} catch (e) {
  bootLog(`retentionSweep failed: ${e instanceof Error ? e.message : String(e)}`);
}

const app = createApp({ mode: "node" });
bootLog("app created");

// 本番環境: 静的ファイル配信（SERVE_STATIC 環境変数で有効化）
const staticDir = process.env.SERVE_STATIC;
if (staticDir && existsSync(staticDir)) {
  // /Graphium/ パスで静的ファイルを配信
  app.use("/Graphium/*", serveStatic({ root: staticDir, rewriteRequestPath: (path) => path.replace(/^\/Graphium/, "") }));
  // SPA フォールバック: /Graphium 配下の未マッチルートに index.html を返す
  app.get("/Graphium/*", serveStatic({ root: staticDir, path: "index.html" }));
  // ルートを /Graphium/ にリダイレクト
  app.get("/", (c) => c.redirect("/Graphium/"));
}

// サーバー起動
const port = Number(process.env.PORT ?? 3001);
bootLog(`calling serve() on port=${port}`);

try {
  serve({ fetch: app.fetch, port }, (info: { port: number }) => {
    bootLog(`listening on port=${info.port}`);
    console.log(`Graphium backend running on http://localhost:${port}`);
    if (staticDir) {
      console.log(`Serving static files from ${staticDir}`);
    }
  });
} catch (e) {
  // serve() が同期的に throw した場合（port bind 失敗等）はここで stderr に
  // 詳細を残す。これが無いと sidecar 側からは「無音タイムアウト」に見える。
  const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  bootLog(`serve() threw: ${msg}`);
  process.exit(98);
}

export default app;
