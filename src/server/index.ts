// Graphium バックエンドサーバー（Hono + Node.js）
// フロントエンドからの /api/* リクエストを処理する
// 本番環境では静的ファイルの配信も行う

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { setDataDir as setModelsDataDir } from "./config/models.js";
import { setDataDir as setProfilesDataDir } from "./config/profiles.js";
import healthRoutes from "./routes/health.js";
import modelsRoutes from "./routes/models.js";
import profilesRoutes from "./routes/profiles.js";
import agentRoutes from "./routes/agent.js";
import toolsRoutes from "./routes/tools.js";
import authRoutes from "./routes/auth.js";

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
console.log(`[server] Data directory: ${dataDir}`);
setModelsDataDir(dataDir);
setProfilesDataDir(dataDir);

const app = new Hono();

// CORS 設定（開発時のみ必要。本番は同一オリジン）
// Tauri オリジンも常に含める（dev サーバーをデスクトップアプリが共用する場合に必要）
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5174")
  .split(",")
  .map((o) => o.trim());
// Tauri webview オリジンを必ず追加（macOS: tauri://, Windows: https://tauri.localhost）
for (const tauriOrigin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
  if (!allowedOrigins.includes(tauriOrigin)) allowedOrigins.push(tauriOrigin);
}

app.use(
  "/api/*",
  cors({
    origin: allowedOrigins,
    allowHeaders: ["Content-Type", "X-API-Key", "X-Registry-URL"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// API ルートマウント
app.route("/api/health", healthRoutes);
app.route("/api/models", modelsRoutes);
app.route("/api/profiles", profilesRoutes);
app.route("/api/agent", agentRoutes);
app.route("/api/tools", toolsRoutes);
app.route("/api/auth", authRoutes);

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

serve({ fetch: app.fetch, port }, () => {
  console.log(`Graphium backend running on http://localhost:${port}`);
  if (staticDir) {
    console.log(`Serving static files from ${staticDir}`);
  }
});

export default app;
