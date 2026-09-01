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

/**
 * Host ヘッダーの許可判定（DNS リバインディング対策）。
 *
 * ローカルサーバーは 127.0.0.1 で待つが、それだけでは外から触られないとは言えない。
 * 攻撃者のドメインを一旦自分のIPに解決させ、被害者がページを開いた後に 127.0.0.1 へ
 * 貼り替えると、ブラウザから見て「同一オリジン」のまま、このサーバーへ届いてしまう
 * （CORS は同一オリジン扱いなので効かない）。そのときブラウザが送る Host は
 * 攻撃者のドメインなので、Host を見れば弾ける。
 *
 * 既定はループバック名のみ。LAN へ意図的に公開する運用（Docker で ports を
 * 127.0.0.1 以外へ広げる等）では GRAPHIUM_ALLOWED_HOSTS に列挙して明示的に開ける。
 * 「バインド先を広げただけで LAN 全体へ開く」を既定にしないための fail-closed。
 */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isAllowedHost(hostHeader: string | undefined, allowList: string[]): boolean {
  if (!hostHeader) return false; // Host 無し（HTTP/1.0 等）は通さない
  // ポートを落として名前だけで見る。IPv6 リテラルは括弧の外側にポートが付く。
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":")[0];
  if (LOOPBACK_HOSTS.has(name)) return true;
  return allowList.some((a) => {
    const allowed = a.trim().toLowerCase();
    if (!allowed) return false;
    // 明示リストはポート付きでもポート無しでも書けるようにする
    return allowed === host || allowed === name;
  });
}

export function createApp(options: CreateAppOptions = { mode: "node" }): Hono {
  const { mode } = options;

  // Vercel モードではファイルシステム永続化を無効化
  if (mode === "vercel") {
    setServerMode("vercel");
    setProfilesServerMode("vercel");
  }

  const app = new Hono();

  // Host 検証。Vercel はデプロイ先ドメインで来るので対象外（そこは公開 API）。
  if (mode !== "vercel") {
    const allowedHosts = (process.env.GRAPHIUM_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    app.use("*", async (c, next) => {
      // Host ヘッダーが無い経路（HTTP/1.0、テストの app.request 等）では
      // URL 側のホストで見る。node-server では URL 自体が Host から組まれるので
      // 実運用では同じ値になる。どちらも無い、が起きないようにするための二段。
      let host = c.req.header("host");
      if (!host) {
        try {
          host = new URL(c.req.url).host;
        } catch {
          host = undefined;
        }
      }
      if (!isAllowedHost(host, allowedHosts)) {
        return c.json(
          {
            error:
              "Host not allowed. Set GRAPHIUM_ALLOWED_HOSTS to expose this server beyond localhost.",
          },
          403,
        );
      }
      await next();
    });
  }

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
