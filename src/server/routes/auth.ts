// OAuth コールバック API（デスクトップ版 Google OAuth 用）
// GET /api/auth/callback     — Google リダイレクト受け取り
// GET /api/auth/token-status — フロントエンドがポーリングで認証コードを取得

import { Hono } from "hono";

const app = new Hono();

// 認証コードの一時保存（state → code）
const pendingCodes = new Map<
  string,
  { code: string; receivedAt: number }
>();

// 5分以上経過したエントリを自動削除
setInterval(() => {
  const now = Date.now();
  for (const [state, entry] of pendingCodes) {
    if (now - entry.receivedAt > 5 * 60 * 1000) pendingCodes.delete(state);
  }
}, 60 * 1000);

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

export default app;
