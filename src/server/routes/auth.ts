// OAuth コールバック API（デスクトップ・Web PKCE 共用）
// GET  /api/auth/callback     — Google リダイレクト受け取り
// GET  /api/auth/token-status — フロントエンドがポーリングで認証コードを取得
// POST /api/auth/exchange     — 認証コード → トークン交換（Web PKCE 用）
// POST /api/auth/refresh      — refresh_token → access_token 更新（Web PKCE 用）

import { Hono } from "hono";

// Google OAuth 設定（サーバー側でトークン交換するため client_secret が必要）
// PKCE フローでは Desktop 用の client_id + client_secret ペアを使用
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ??
  process.env.VITE_GOOGLE_DESKTOP_CLIENT_ID ??
  process.env.VITE_GOOGLE_CLIENT_ID ??
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";
const CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ??
  process.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET ??
  "";

const app = new Hono();

// 認証コードの一時保存（state → code）
const pendingCodes = new Map<
  string,
  { code: string; receivedAt: number }
>();

// 5分以上経過したエントリを自動削除
// Vercel Serverless ではモジュールレベルの setInterval は不要（各 invocation が独立）
if (process.env.VERCEL !== "1") {
  setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of pendingCodes) {
      if (now - entry.receivedAt > 5 * 60 * 1000) pendingCodes.delete(state);
    }
  }, 60 * 1000);
}

// Google OAuth リダイレクト先
app.get("/callback", (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(
      `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Graphium</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h2{color:#dc3545}</style></head>
<body><div class="card"><h2>Authentication failed</h2><p>${error}</p><p>You can close this tab and try again in Graphium.</p></div></body></html>`,
    );
  }

  if (!code || !state) {
    return c.html(
      `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Graphium</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h2{color:#dc3545}</style></head>
<body><div class="card"><h2>Invalid callback</h2><p>Missing required parameters.</p></div></body></html>`,
    );
  }

  pendingCodes.set(state, { code, receivedAt: Date.now() });

  return c.html(
    `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Graphium</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f8f9fa}
.card{text-align:center;padding:2rem;border-radius:12px;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.1)}
h2{color:#22c55e}</style></head>
<body><div class="card"><h2>&#10003; Authentication successful!</h2><p>You can close this tab and return to Graphium.</p></div></body></html>`,
  );
});

// フロントエンドからのポーリング（認証コード取得）
app.get("/token-status", (c) => {
  const state = c.req.query("state");
  if (!state) {
    return c.json({ status: "error", message: "Missing state parameter" }, 400);
  }

  const entry = pendingCodes.get(state);
  if (!entry) {
    return c.json({ status: "pending" });
  }

  // 1回限りの取得（取得後に削除）
  pendingCodes.delete(state);
  return c.json({ status: "ready", code: entry.code });
});

// Web PKCE: 認証コード → トークン交換
// client_secret はサーバー側で保持し、フロントエンドには渡さない
app.post("/exchange", async (c) => {
  if (!CLIENT_SECRET) {
    return c.json(
      { error: "GOOGLE_CLIENT_SECRET が設定されていません" },
      500,
    );
  }

  const body = await c.req.json<{
    code: string;
    code_verifier: string;
    redirect_uri: string;
  }>();

  if (!body.code || !body.code_verifier || !body.redirect_uri) {
    return c.json({ error: "code, code_verifier, redirect_uri は必須です" }, 400);
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: body.code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: body.redirect_uri,
      code_verifier: body.code_verifier,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Token exchange failed:", res.status, err);
    return c.json({ error: "トークン交換に失敗しました" }, 502);
  }

  const data = await res.json();
  return c.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
    token_type: data.token_type,
  });
});

// Web PKCE: refresh_token → access_token 更新
app.post("/refresh", async (c) => {
  if (!CLIENT_SECRET) {
    return c.json(
      { error: "GOOGLE_CLIENT_SECRET が設定されていません" },
      500,
    );
  }

  const body = await c.req.json<{ refresh_token: string }>();
  if (!body.refresh_token) {
    return c.json({ error: "refresh_token は必須です" }, 400);
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: body.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Token refresh failed:", res.status, err);
    return c.json({ error: "トークン更新に失敗しました" }, 502);
  }

  const data = await res.json();
  return c.json({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_in: data.expires_in,
    token_type: data.token_type,
  });
});

export default app;
