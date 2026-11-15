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
import meetingRoutes from "./routes/meeting.js";
import storageRoutes from "./routes/storage.js";
import mcpRoutes from "./routes/mcp.js";
import worldGroundingRoutes from "./routes/world-grounding.js";
import embeddingsRoutes from "./routes/embeddings.js";
import urlRoutes from "./routes/url.js";
import usageRoutes from "./routes/usage.js";
import clipRoutes from "./routes/clip.js";
import assistantConnectRoutes from "./routes/assistant-connect.js";
import sealRoutes from "./routes/seal.js";

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

/**
 * 書き込み系の要求（POST / PUT / PATCH / DELETE）を送ってきたページの判定（CSRF 対策）。
 *
 * CORS は「他のサイトが応答を読む」のを止めるだけで、要求が届くのは止めない。
 * `Content-Type: text/plain` の fetch や form の送信は preflight 無しで届くので、
 * 利用者が Graphium を起動したまま悪意のあるページを開くと、そのページから
 * ローカル API を叩けてしまう（MCP の接続テストは stdio のコマンドを起動するので、
 * 放っておくと任意コマンドの実行になる）。Host は 127.0.0.1 のままなので Host 検証も効かない。
 *
 * ブラウザは書き込み系の要求に必ず Origin を付けるので、Origin を見て断る:
 *   - Origin 無し → ブラウザ以外（同梱の MCP サーバー・CLI・テスト）。通す
 *   - 許可リスト（CORS_ORIGINS と Tauri の WebView）・ループバック（dev の vite）・
 *     自分自身と同じホスト（セルフホストで画面と API を同じオリジンで配る形）→ 通す
 *   - Chrome 拡張機能 → Web クリップの送信とペアリングの申し込み（/api/clip・/api/clip/pair・/api/clip/pair/:id）だけ通す
 *   - それ以外（他のサイト・"null"）→ 断る
 */
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;
// 拡張機能が書き込みに使う口だけ（クリップの送信とペアリングの申し込み・結果の問い合わせ）。
// 承認（/pair-requests/:id）や合言葉の作り直しは利用者の画面の操作なので、拡張機能には開けない。
const EXTENSION_WRITE_PATH_RE = /^\/api\/clip(\/pair(\/[^/]+)?)?$/;

export function isAllowedWriteOrigin(args: {
  origin: string | undefined;
  path: string;
  host: string | undefined;
  allowedOrigins: string[];
}): boolean {
  const { origin, path, host, allowedOrigins } = args;
  if (origin === undefined) return true;
  const o = origin.trim();
  if (allowedOrigins.includes(o)) return true;
  if (LOOPBACK_ORIGIN_RE.test(o)) return true;
  if (EXTENSION_ORIGIN_RE.test(o)) return EXTENSION_WRITE_PATH_RE.test(path);
  try {
    const u = new URL(o);
    if ((u.protocol === "http:" || u.protocol === "https:") && host && u.host === host.trim().toLowerCase()) {
      return true;
    }
  } catch {
    // "null" など URL にならない Origin は断る
  }
  return false;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

  // 他のサイトからの書き込み系の要求を断る（isAllowedWriteOrigin のコメント参照）。
  // Vercel はデプロイ先の公開 API で、利用者の手元のデータを持たないので対象外。
  if (mode !== "vercel") {
    app.use("/api/*", async (c, next) => {
      if (
        UNSAFE_METHODS.has(c.req.method) &&
        !isAllowedWriteOrigin({
          origin: c.req.header("origin"),
          path: c.req.path,
          host: c.req.header("host"),
          allowedOrigins,
        })
      ) {
        return c.json({ error: "Cross-site request blocked" }, 403);
      }
      await next();
    });
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
      // X-Graphium-Clip-Token（Web クリップの合言葉）はわざと列挙しない。拡張機能は
      // host_permissions で CORS の外から送るので要らず、Web ページからは送らせない（routes/clip.ts）
      allowHeaders: ["Content-Type", "X-API-Key", "X-Registry-URL", "X-LLM-API-Key", "X-Graphium-Token", "X-MCP-Servers"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // API の応答を「文書として開かれても何も実行されない」形にする。
  // image-proxy は外部の画像を、/api/storage/media は取り込んだファイルをそのまま返す。
  // 攻撃者のページがそこへ遷移すると、中身（スクリプト入りの SVG・HTML）がこのサーバーの
  // オリジンで動き、同一オリジンとして上の書き込み検査をすり抜けてしまう。
  // CSP の sandbox は文書として開いたときだけ効き（<img> や fetch には影響しない）、
  // オリジンを不透明にしてスクリプトを止める。PDF はブラウザ内蔵のビューアが sandbox 下で
  // 開けなくなるので除く（PDF の中のスクリプトはこのオリジンでは動かない）。
  if (mode !== "vercel") {
    app.use("/api/*", async (c, next) => {
      await next();
      const type = (c.res.headers.get("content-type") ?? "").toLowerCase();
      const extra: Record<string, string> = {};
      if (!type.startsWith("application/pdf")) {
        extra["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      }
      if (!c.res.headers.has("X-Content-Type-Options")) extra["X-Content-Type-Options"] = "nosniff";
      try {
        for (const [k, v] of Object.entries(extra)) c.res.headers.set(k, v);
      } catch {
        // 上流の fetch の Response をそのまま返す経路ではヘッダーが不変なので、作り直して書く
        const res = new Response(c.res.body, c.res);
        for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
        c.res = res;
      }
    });
  }

  // API ルートマウント
  app.route("/api/health", healthRoutes);
  app.route("/api/models", modelsRoutes);
  app.route("/api/profiles", profilesRoutes);
  app.route("/api/agent", agentRoutes);
  app.route("/api/tools", toolsRoutes);
  app.route("/api/wiki", wikiRoutes);
  app.route("/api/prov", provRoutes);
  app.route("/api/translate", translateRoutes);
  app.route("/api/meeting", meetingRoutes);
  app.route("/api/storage", storageRoutes);
  app.route("/api/mcp", mcpRoutes);
  app.route("/api/world-grounding", worldGroundingRoutes);
  app.route("/api/embeddings", embeddingsRoutes);
  app.route("/api/url", urlRoutes);
  app.route("/api/usage", usageRoutes);
  app.route("/api/clip", clipRoutes);
  app.route("/api/assistant-connect", assistantConnectRoutes);
  // 封印の時刻証明は外部の局へ送るので、手元の sidecar / セルフホストだけで出す
  // （Vercel の公開 API を局への中継にしない）
  if (mode !== "vercel") app.route("/api/seal", sealRoutes);

  return app;
}
