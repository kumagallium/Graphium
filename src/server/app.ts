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
import authRoutes from "./routes/auth.js";
import wikiRoutes from "./routes/wiki.js";

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
      allowHeaders: ["Content-Type", "X-API-Key", "X-Registry-URL", "X-LLM-API-Key"],
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
  app.route("/api/wiki", wikiRoutes);

  return app;
}
