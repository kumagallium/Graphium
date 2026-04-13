// デスクトップ版 Google OAuth 認証（Authorization Code + PKCE）
// Tauri 環境でシステムブラウザを使って認証し、sidecar のコールバックで受け取る
//
// セキュリティモデル:
// - Google は「デスクトップ アプリ」タイプの client_secret を非機密として扱う
//   https://developers.google.com/identity/protocols/oauth2/native-app
// - PKCE（code_verifier / code_challenge）を併用し、認証コード傍受攻撃を防止
// - client_secret 単体ではユーザーデータにアクセス不可（ユーザー同意 + PKCE が必要）

import { openUrl } from "@tauri-apps/plugin-opener";

// デスクトップ用 OAuth クライアント（Google Cloud Console で「デスクトップ アプリ」として作成）
// VITE_GOOGLE_DESKTOP_CLIENT_ID / VITE_GOOGLE_DESKTOP_CLIENT_SECRET は
// ビルド時に Vite が埋め込む（CI では GitHub Secrets から注入）
const DEFAULT_CLIENT_ID =
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";
const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_ID as string) ||
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) ||
  DEFAULT_CLIENT_ID;
const CLIENT_SECRET =
  (import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET as string) || "";

const SCOPES =
  "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const REDIRECT_URI = "http://localhost:3001/api/auth/callback";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

const STORAGE_KEY = "graphium_desktop_auth";
// トークン期限切れ前に自動更新するまでの余裕（5分）
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// ポーリング間隔（1秒）
const POLL_INTERVAL_MS = 1000;
// ポーリングタイムアウト（5分）
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

type DesktopAuthState = {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
};

let authState: DesktopAuthState = loadFromStorage();
let authListeners: Array<(token: string | null) => void> = [];
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

// --- ストレージ ---

function loadFromStorage(): DesktopAuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, refreshToken: null, expiresAt: null };
    return JSON.parse(raw) as DesktopAuthState;
  } catch {
    return { accessToken: null, refreshToken: null, expiresAt: null };
  }
}

function saveToStorage(state: DesktopAuthState) {
  if (state.accessToken || state.refreshToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
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
  // base64url エンコード
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

// --- トークン交換・リフレッシュ ---

async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<void> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Token exchange failed:", res.status, err);
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
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: authState.refreshToken,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
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

// --- 公開 API（google-auth.ts と同一インターフェース）---

// 初期化（保存済みトークンの復元・リフレッシュ）
export async function initDesktopAuth(): Promise<void> {
  authState = loadFromStorage();

  if (authState.refreshToken) {
    if (authState.accessToken && authState.expiresAt && Date.now() < authState.expiresAt) {
      scheduleTokenRefresh(authState.expiresAt);
      authListeners.forEach((fn) => fn(authState.accessToken));
    } else {
      await refreshAccessToken();
    }
  }
}

// サインイン（システムブラウザで Google 認証画面を開く）
export async function signInDesktop(): Promise<void> {
  if (import.meta.env.DEV) {
    console.log("[desktop-auth] signInDesktop started, CLIENT_ID:", CLIENT_ID.slice(0, 20) + "...");
    console.log("[desktop-auth] CLIENT_SECRET present:", CLIENT_SECRET.length > 0);
  }

  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    access_type: "offline",
    prompt: "consent",
  });

  const authUrl = `${AUTH_ENDPOINT}?${params.toString()}`;

  // システムブラウザで認証画面を開く
  await openUrl(authUrl);

  // sidecar をポーリングして認証コードを待つ
  if (import.meta.env.DEV) console.log("[desktop-auth] Polling for auth code...");
  const code = await pollForAuthCode(state);
  if (import.meta.env.DEV) console.log("[desktop-auth] Got auth code, exchanging for tokens...");
  await exchangeCode(code, codeVerifier);
  if (import.meta.env.DEV) console.log("[desktop-auth] Token exchange complete, authenticated");
}

// sidecar をポーリングして認証コードを取得
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
          `http://localhost:3001/api/auth/token-status?state=${state}`,
        );
        const data = await res.json();

        if (data.status === "ready") {
          resolve(data.code);
          return;
        }
      } catch {
        // sidecar 未起動等の場合はリトライ
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    };

    poll();
  });
}

// サインアウト
export function signOutDesktop(): void {
  if (authState.accessToken) {
    fetch(`${REVOKE_ENDPOINT}?token=${authState.accessToken}`, {
      method: "POST",
    }).catch(() => {});
  }
  setAuthState(null, null, null);
}

// 現在のアクセストークンを取得（期限切れなら null）
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

// 認証状態変化リスナー
export function onAuthChange(
  fn: (token: string | null) => void,
): () => void {
  authListeners.push(fn);
  return () => {
    authListeners = authListeners.filter((l) => l !== fn);
  };
}

// 認証済みかどうか
export function isSignedIn(): boolean {
  return getAccessToken() !== null;
}
