// Hono アプリ構築（index.ts / Vercel エントリポイントから共用）
// サーバー起動（serve()）はここに含めず、呼び出し側に委ねる

import { Hono } from "hono";
import { cors } from "hono/cors";
import { setServerMode } from "./config/models.js";
import { setServerMode as setProfilesServerMode } from "./config/profiles.js";
import healthRoutes from "./routes/health.js";
import modelsRoutes from "./routes/models.js";
import profilesRoutes from "./routes/profiles.js";
import agentRoutes from "./routes/agent.js";
import toolsRoutes from "./routes/tools.js";
import wikiRoutes from "./routes/wiki.js";
import provRoutes from "./routes/prov.js";
import translateRoutes from "./routes/translate.js";
import storageRoutes from "./routes/storage.js";
import mcpRoutes from "./routes/mcp.js";
import worldGroundingRoutes from "./routes/world-grounding.js";
import embeddingsRoutes from "./routes/embeddings.js";
import urlRoutes from "./routes/url.js";
import usageRoutes from "./routes/usage.js";

export type AppMode = "node" | "vercel";

export type CreateAppOptions = {
  mode: AppMode;
};

export function createApp(options: CreateAppOptions = { mode: "node" }): Hono {
  const { mode } = options;

  // Vercel モードではファイルシステム永続化を無効化
  if (mode === "vercel") {
    setServerMode("vercel");
    setProfilesServerMode("vercel");
  }

  const app = new Hono();

  // CORS 設定
  const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5174")
    .split(",")
    .map((o) => o.trim());
  // Tauri webview オリジンを追加
  for (const tauriOrigin of ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]) {
    if (!allowedOrigins.includes(tauriOrigin)) allowedOrigins.push(tauriOrigin);
  }

  app.use(
    "/api/*",
    cors({
      origin: allowedOrigins,
      // 注意: フロント（features/ai-assistant/api.ts の apiHeaders）が送るカスタム
      // ヘッダーは必ずここに列挙すること。漏れると Tauri 版（tauri://localhost →
      // 127.0.0.1:3001 の cross-origin）で preflight が失敗し、そのヘッダーが付く
      // 全リクエストが落ちる。Web 版は vite proxy の same-origin で CORS 自体が
      // 発生しないため、漏れは Tauri でしか発症しない（X-MCP-Servers 欠落で
      // MCP 登録ユーザーの AI が全滅した実例あり）。回帰テスト: app.test.ts
      allowHeaders: ["Content-Type", "X-API-Key", "X-Registry-URL", "X-LLM-API-Key", "X-Graphium-Token", "X-MCP-Servers"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // API ルートマウント
  app.route("/api/health", healthRoutes);
  app.route("/api/models", modelsRoutes);
  app.route("/api/profiles", profilesRoutes);
  app.route("/api/agent", agentRoutes);
  app.route("/api/tools", toolsRoutes);
  app.route("/api/wiki", wikiRoutes);
  app.route("/api/prov", provRoutes);
  app.route("/api/translate", translateRoutes);
  app.route("/api/storage", storageRoutes);
  app.route("/api/mcp", mcpRoutes);
  app.route("/api/world-grounding", worldGroundingRoutes);
  app.route("/api/embeddings", embeddingsRoutes);
  app.route("/api/url", urlRoutes);
  app.route("/api/usage", usageRoutes);

  return app;
}
