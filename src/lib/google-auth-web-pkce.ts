// Web 版 Google OAuth 認証（Authorization Code + PKCE）
// セルフホスト環境用: サーバー側で client_secret を使ってトークン交換
// GitHub Pages 等のサーバーなし環境では利用不可（GIS Implicit Grant にフォールバック）

import { apiBase } from "./platform";

// PKCE フローには client_secret が必要なため、Desktop 用のクライアント資格情報を使用
// （Web 用 client_id には client_secret が存在しない）
const DEFAULT_CLIENT_ID =
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";
const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID as string) ||
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ||
  DEFAULT_CLIENT_ID;

const SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

const STORAGE_KEY = "graphium_auth_pkce";
// 以前 PKCE で認証成功したことがあるか（再サインイン時に consent をスキップする判定用）
const HAS_PKCE_CONSENTED_KEY = "graphium_pkce_consented";
// トークン期限切れ前に自動更新するまでの余裕（5分）
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// ポーリング間隔（1秒）
const POLL_INTERVAL_MS = 1000;
// ポーリングタイムアウト（5分）
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type PkceAuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

let authState: PkceAuthState = loadFromStorage();
let authListeners: Array<(token: string | null) => void> = [];
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

// --- サーバー検出 ---

let serverAvailable: boolean | null = null;

/** サーバーの PKCE エンドポイントが利用可能かチェック */
export async function detectPkceSupport(): Promise<boolean> {
  if (serverAvailable !== null) return serverAvailable;
  try {
    const res = await fetch(`${apiBase()}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      serverAvailable = false;
    } else {
      // JSON レスポンスかチェック（GitHub Pages 等の SPA フォールバックで
      // HTML が 200 で返る場合に PKCE 有効と誤検出するのを防ぐ）
      const data = await res.json();
      serverAvailable = typeof data?.status === "string";
    }
  } catch {
    serverAvailable = false;
  }
  return serverAvailable;
}

export function isPkceAvailable(): boolean {
  return serverAvailable === true;
}

/** PKCE セッションが存在する場合にサーバーを利用可能としてマーク */
export function markServerAvailable(): void {
  serverAvailable = true;
}

// --- ストレージ ---

function loadFromStorage(): PkceAuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null, expiresAt: null };
    return JSON.parse(raw) as PkceAuthState;
  } catch {
    return { accessToken: null, refreshToken: null, expiresAt: null };
  }
}

function saveToStorage(state: PkceAuthState) {
  if (state.accessToken || state.refreshToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(HAS_PKCE_CONSENTED_KEY, "true");
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function hasPreviousPkceConsent(): boolean {
  return localStorage.getItem(HAS_PKCE_CONSENTED_KEY) === "true";
}

// --- PKCE ヘルパー ---

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// --- 状態管理 ---

function setAuthState(
  accessToken: string | null,
  refreshToken: string | null,
  expiresAt: number | null,
) {
  authState = { accessToken, refreshToken, expiresAt };
  saveToStorage(authState);
  scheduleTokenRefresh(expiresAt);
  authListeners.forEach((fn) => fn(accessToken));
}

function scheduleTokenRefresh(expiresAt: number | null) {
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  if (!expiresAt || !authState.refreshToken) return;

  const delay = expiresAt - Date.now() - REFRESH_MARGIN_MS;
  if (delay <= 0) {
    refreshAccessToken().catch(console.error);
    return;
  }

  refreshTimerId = setTimeout(() => {
    refreshTimerId = null;
    refreshAccessToken().catch(console.error);
  }, delay);
}

// --- トークン交換・リフレッシュ（サーバー経由）---

async function exchangeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<void> {
  const res = await fetch(`${apiBase()}/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`トークン交換失敗: ${err}`);
  }

  const data = await res.json();
  const expiresAt = Date.now() + data.expires_in * 1000;
  setAuthState(data.access_token, data.refresh_token ?? null, expiresAt);
}

async function refreshAccessToken(): Promise<void> {
  if (!authState.refreshToken) {
    setAuthState(null, null, null);
    return;
  }

  try {
    const res = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: authState.refreshToken }),
    });

    if (!res.ok) {
      console.error("トークンリフレッシュ失敗、再ログインが必要です");
      setAuthState(null, null, null);
      return;
    }

    const data = await res.json();
    const expiresAt = Date.now() + data.expires_in * 1000;
    setAuthState(
      data.access_token,
      data.refresh_token ?? authState.refreshToken,
      expiresAt,
    );
  } catch (e) {
    console.error("トークンリフレッシュエラー:", e);
    setAuthState(null, null, null);
  }
}

// --- コールバックのリダイレクト URI ---

function getCallbackRedirectUri(): string {
  // dev 環境: Vite (5174) と backend (3001) が別ポートなので backend に直接リダイレクト
  // 本番環境: 同一オリジンなのでそのまま使用
  if (import.meta.env.DEV) {
    return "http://localhost:3001/api/auth/callback";
  }
  return `${window.location.origin}/api/auth/callback`;
}

// --- ポーリング ---

async function pollForAuthCode(state: string): Promise<string> {
  const startTime = Date.now();

  return new Promise<string>((resolve, reject) => {
    const poll = async () => {
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        reject(new Error("認証タイムアウト: 5分以内に認証を完了してください"));
        return;
      }

      try {
        const res = await fetch(
          `${apiBase()}/auth/token-status?state=${state}`,
        );
        const data = await res.json();

        if (data.status === "ready") {
          resolve(data.code);
          return;
        }
      } catch {
        // サーバー未応答の場合はリトライ
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
  });
}

// --- 公開 API ---

/** 初期化（保存済みトークンの復元・リフレッシュ） */
export async function initPkceAuth(): Promise<void> {
  authState = loadFromStorage();

  if (authState.refreshToken) {
    if (
      authState.accessToken &&
      authState.expiresAt &&
      Date.now() < authState.expiresAt
    ) {
      // 有効なトークンがある → リフレッシュタイマーをセット
      scheduleTokenRefresh(authState.expiresAt);
      authListeners.forEach((fn) => fn(authState.accessToken));
    } else {
      // 期限切れ → refresh_token で更新
      await refreshAccessToken();
    }
  }

  // タブのフォアグラウンド復帰時にトークンをチェック
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function handleVisibilityChange() {
  if (document.visibilityState !== "visible") return;

  if (!authState.accessToken || !authState.expiresAt) {
    if (authState.refreshToken) {
      refreshAccessToken().catch(console.error);
    }
    return;
  }

  const remaining = authState.expiresAt - Date.now();
  if (remaining < REFRESH_MARGIN_MS) {
    refreshAccessToken().catch(console.error);
    return;
  }

  if (refreshTimerId === null) {
    scheduleTokenRefresh(authState.expiresAt);
  }
}

/** サインイン（ポップアップで Google 認証画面を開く） */
export async function signInPkce(): Promise<void> {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);
  const redirectUri = getCallbackRedirectUri();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    // 初回: consent（スコープ同意 + refresh_token 取得に必要）
    // 再サインイン: select_account（アカウント選択のみ、同意画面をスキップ）
    prompt: hasPreviousPkceConsent() ? "select_account" : "consent",
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

  // ポップアップで認証画面を開く
  const popup = window.open(
    authUrl,
    "graphium-oauth",
    "width=500,height=600,scrollbars=yes",
  );

  if (!popup) {
    // ポップアップがブロックされた場合はリダイレクト
    window.location.href = authUrl;
    return;
  }

  // サーバーをポーリングして認証コードを待つ
  const code = await pollForAuthCode(state);

  // ポップアップを閉じる
  try {
    popup.close();
  } catch {
    // 既に閉じられている場合は無視
  }

  // サーバー経由でトークン交換
  await exchangeCode(code, codeVerifier, redirectUri);
}

/** サインアウト */
export function signOutPkce(): void {
  if (authState.accessToken) {
    fetch(
      `https://oauth2.googleapis.com/revoke?token=${authState.accessToken}`,
      { method: "POST" },
    ).catch(() => {});
  }
  setAuthState(null, null, null);
}

/** 現在のアクセストークンを取得（期限切れなら null） */
export function getAccessToken(): string | null {
  if (!authState.accessToken || !authState.expiresAt) return null;
  if (Date.now() >= authState.expiresAt) {
    if (authState.refreshToken) {
      refreshAccessToken().catch(console.error);
    }
    return null;
  }
  return authState.accessToken;
}

/** 認証状態変化リスナー */
export function onAuthChange(
  fn: (token: string | null) => void,
): () => void {
  authListeners.push(fn);
  return () => {
    authListeners = authListeners.filter((l) => l !== fn);
  };
}

/** 認証済みかどうか */
export function isSignedIn(): boolean {
  return getAccessToken() !== null;
}

/** 保存済みの refresh_token があるか（PKCE セッション継続判定用） */
export function hasRefreshToken(): boolean {
  return authState.refreshToken !== null;
}
