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

// 親プロセス（Tauri アプリ本体）の生存を監視し、親が消えたら自決する watchdog。
//
// sidecar は std::process::Command で spawn された独立プロセスなので、本体が
// Cmd+Q / 強制終了 / クラッシュ / 自動更新のいずれで終了しても、自動では
// 道連れにならない。port 3001 を握ったまま孤児化すると、次回起動で新バージョンの
// アプリが古い sidecar を「自分のもの」と誤認して再利用し、後から追加した API
// ルートが 404 になる（v0.15.0 で /api/translate が踏んだ事故）。
//
// 親 PID は Rust 側が GRAPHIUM_PARENT_PID で渡す。未設定（dev / Docker）の場合は
// 監視しない。signal 0 はプロセスの存在確認のみで、シグナルは送らない（macOS /
// Linux / Windows いずれでも Node が対応）。
function startParentWatchdog(): void {
  const raw = process.env.GRAPHIUM_PARENT_PID;
  const parentPid = raw ? Number(raw) : Number.NaN;
  if (!Number.isInteger(parentPid) || parentPid <= 0) return;
  bootLog(`parent watchdog armed: parentPid=${parentPid}`);
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      // 親が存在しない（ESRCH）→ sidecar も終了する。
      bootLog(`parent pid=${parentPid} gone — exiting sidecar`);
      process.exit(0);
    }
  }, 2000);
  // watchdog 単独ではイベントループを延命させない（サーバーが生きている間だけ
  // 回ればよい）。サーバーの listener が別途ループを保持している。
  timer.unref();
}

// データディレクトリ設定（環境変数 or デフォルト）
// デスクトップアプリ（sidecar）では Application Support 配下を使う。
// 旧 ~/Documents/Graphium/server-data からは起動時に自動 migration する。
import { homedir } from "node:os";
import { accessSync, constants as fsConstants } from "node:fs";
import { migrateLegacyDataDir } from "./config/migration.js";

function defaultAppSupportDataDir(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "com.graphium.app", "server-data");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "com.graphium.app", "server-data");
    return join(home, "AppData", "Roaming", "com.graphium.app", "server-data");
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "com.graphium.app", "server-data");
  return join(home, ".local", "share", "com.graphium.app", "server-data");
}

function resolveDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const cwdData = join(process.cwd(), "data");
  // cwd が書き込み可能ならそのまま使う（dev モード / Docker）
  try {
    accessSync(process.cwd(), fsConstants.W_OK);
    return cwdData;
  } catch {
    // 書き込み不可（ビルド版アプリ）→ Application Support 配下。
    // 旧 ~/Documents/Graphium/server-data から sidecar 起動時に自動移行する
    // （macOS Sequoia の TCC で Documents が読めない事故への恒久対策）。
    return defaultAppSupportDataDir();
  }
}
const dataDir = resolveDataDir();
bootLog(`dataDir=${dataDir}`);
console.log(`[server] Data directory: ${dataDir}`);

// 旧 ~/Documents/Graphium/server-data から新 dataDir への一回限りの移行。
// TCC で旧 path が読めなくても sidecar 自体は起動を続ける（warn のみ）。
try {
  const mig = migrateLegacyDataDir(dataDir);
  if (mig.copied.length > 0) {
    bootLog(`legacy migration: copied=${mig.copied.join(",")}`);
    console.log(
      `[server] Migrated from legacy dataDir (~/Documents/Graphium/server-data): ${mig.copied.join(", ")}`,
    );
  }
  for (const e of mig.errors) {
    bootLog(`legacy migration error: ${e.name} - ${e.reason}`);
    console.warn(`[server] Legacy migration error for ${e.name}: ${e.reason}`);
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  bootLog(`legacy migration failed: ${msg}`);
}

setModelsDataDir(dataDir);
setProfilesDataDir(dataDir);
setUsageDataDir(dataDir);
// アプリ本体（Tauri）が起動時に注入するバージョン。dev / Docker では未設定なので
// "dev" にフォールバックする。/api/health で返し、起動時にフロントが自分の
// バージョンと照合して「古い自分の sidecar」を検知するために使う。
const appVersion = process.env.GRAPHIUM_APP_VERSION ?? "dev";
setSidecarIdentity({ pid: process.pid, dataDir, version: appVersion });
bootLog(`data dir config wired (version=${appVersion}), creating app`);

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

// バインド先アドレス。既定はループバック（127.0.0.1）に限定する。
// デスクトップ（Tauri sidecar）とローカル開発では同一マシン内からしか
// アクセスできないようにする — API の大半は無認証なので、0.0.0.0 で
// 待ち受けると LAN 内の他端末からノート読み書きや LLM キー利用が可能になる。
// Docker などコンテナ外へ意図的に公開するデプロイでは GRAPHIUM_BIND_HOST=0.0.0.0
// を明示する（Dockerfile で設定済み。ポート公開範囲は compose の ports で制御）。
const hostname = process.env.GRAPHIUM_BIND_HOST ?? "127.0.0.1";
bootLog(`calling serve() on host=${hostname} port=${port}`);

try {
  serve({ fetch: app.fetch, port, hostname }, (info: { port: number }) => {
    bootLog(`listening on ${hostname}:${info.port}`);
    console.log(`Graphium backend running on http://${hostname}:${port}`);
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

// 親（アプリ本体）の死を監視して自決する watchdog を起動する。
startParentWatchdog();

export default app;
