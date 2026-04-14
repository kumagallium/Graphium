// Google 認証（プラットフォーム共通エントリポイント）
// Web（セルフホスト）: Authorization Code + PKCE（サーバー経由でトークン交換）
// Web（GitHub Pages 等）: GIS SDK（Implicit Grant）
// デスクトップ: Authorization Code + PKCE（google-auth-desktop.ts に委任）

import { isTauri, isMobile } from "./platform";
import * as desktop from "./google-auth-desktop";
import * as webPkce from "./google-auth-web-pkce";

const DEFAULT_CLIENT_ID =
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";
const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || DEFAULT_CLIENT_ID;

const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const STORAGE_KEY = "graphium_auth";
// 以前ログインに成功した記録（サイレントリフレッシュ判定用）
const HAS_CONSENTED_KEY = "graphium_has_consented";
// リダイレクト認証中フラグ（モバイル用）
const REDIRECT_PENDING_KEY = "graphium_auth_redirect_pending";

// GIS SDK のグローバル型定義
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type: string; message: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};

type AuthState = {
  accessToken: string | null;
  expiresAt: number | null;
};

// トークン期限切れ前に自動更新するまでの余裕（5分）
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// サイレントリフレッシュのタイムアウト（秒）
const SILENT_REFRESH_TIMEOUT_MS = 5000;
// サイレントリフレッシュの最大リトライ回数
const MAX_REFRESH_RETRIES = 3;
// リトライ間隔（ミリ秒）
const REFRESH_RETRY_INTERVAL_MS = 10 * 1000;

let tokenClient: TokenClient | null = null;
let authState: AuthState = loadFromStorage();
let authListeners: Array<(token: string | null) => void> = [];
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;
let refreshRetryCount = 0;
// signIn() で consent なしのリクエストが失敗した場合に consent にフォールバックするフラグ
let pendingConsentFallback = false;

// 以前ログインに成功したことがあるか
function hasPreviousConsent(): boolean {
  return localStorage.getItem(HAS_CONSENTED_KEY) === "true";
}

// localStorage からトークンを復元
function loadFromStorage(): AuthState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, expiresAt: null };
    const stored = JSON.parse(raw) as AuthState;
    // 期限切れチェック
    if (stored.expiresAt && Date.now() < stored.expiresAt) {
      return stored;
    }
    // 期限切れ → クリア
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return { accessToken: null, expiresAt: null };
}

// localStorage にトークンを保存
function saveToStorage(state: AuthState) {
  if (state.accessToken) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(HAS_CONSENTED_KEY, "true");
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// OAuth リダイレクト応答をチェック（モバイル用）
// Google Implicit Grant はトークンを URL フラグメント (#access_token=...) で返す
function handleOAuthRedirect(): boolean {
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token")) return false;

  const params = new URLSearchParams(hash.substring(1));
  const accessToken = params.get("access_token");
  const expiresIn = params.get("expires_in");

  if (accessToken && expiresIn) {
    const expiresAt = Date.now() + parseInt(expiresIn) * 1000;
    setAuthState(accessToken, expiresAt);
    // URL をクリーンアップ（トークンを履歴に残さない）
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    localStorage.removeItem(REDIRECT_PENDING_KEY);
    return true;
  }

  // エラー応答
  const error = params.get("error");
  if (error) {
    console.error("OAuth リダイレクトエラー:", error);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    localStorage.removeItem(REDIRECT_PENDING_KEY);
  }
  return false;
}

// モバイル用リダイレクト URI を取得
function getRedirectUri(): string {
  return window.location.origin + (import.meta.env.BASE_URL || "/");
}

// GIS SDK スクリプトをロード
function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("GIS SDK の読み込みに失敗しました"));
    document.head.appendChild(script);
  });
}

// 初期化（トークン期限切れ時はサイレントリフレッシュを試行）
export async function initGoogleAuth(): Promise<void> {
  if (isTauri()) return desktop.initDesktopAuth();
  if (!CLIENT_ID) {
    console.warn("Google OAuth Client ID が設定されていません");
    return;
  }

  // モバイル: OAuth リダイレクト応答をチェック
  if (handleOAuthRedirect()) {
    return;
  }

  // セルフホスト環境: PKCE サーバーが利用可能かチェック
  // PKCE の refresh_token がある場合は優先的にチェック
  if (!isMobile()) {
    const hasPkceSession = webPkce.hasRefreshToken();
    if (hasPkceSession) {
      // 既に PKCE セッションがある → サーバー検出をスキップして PKCE 初期化
      await webPkce.initPkceAuth();
      return;
    }
    // サーバー検出（初回のみ）
    const pkceSupported = await webPkce.detectPkceSupport();
    if (pkceSupported) {
      console.log("PKCE サーバーを検出、Authorization Code フローを使用します");
      await webPkce.initPkceAuth();
      return;
    }
  }

  // PKCE 非対応環境: GIS Implicit Grant フォールバック
  await loadGisScript();

  // サイレントリフレッシュが必要か判定
  const needsSilentRefresh = !authState.accessToken && hasPreviousConsent();
  let resolveSilentRefresh: (() => void) | null = null;

  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) {
        console.error("Google 認証エラー:", response.error);
        // signIn() で prompt:"" が失敗した場合 → consent 画面にフォールバック
        if (pendingConsentFallback) {
          pendingConsentFallback = false;
          console.log("prompt なしでの認証が失敗、consent 画面にフォールバックします");
          tokenClient?.requestAccessToken({ prompt: "consent" });
          return;
        }
        // リトライ可能ならスケジュール
        if (refreshRetryCount < MAX_REFRESH_RETRIES) {
          console.log(`サイレントリフレッシュをリトライします (${refreshRetryCount}/${MAX_REFRESH_RETRIES})`);
          refreshTimerId = setTimeout(() => {
            refreshTimerId = null;
            attemptSilentRefresh();
          }, REFRESH_RETRY_INTERVAL_MS);
        } else {
          setAuthState(null, null);
        }
      } else {
        pendingConsentFallback = false;
        const expiresAt = Date.now() + response.expires_in * 1000;
        setAuthState(response.access_token, expiresAt);
      }
      // サイレントリフレッシュ待ちを解除
      resolveSilentRefresh?.();
      resolveSilentRefresh = null;
    },
    error_callback: (error) => {
      console.error("Google 認証エラー:", error);
      // signIn() で prompt:"" が失敗した場合 → consent 画面にフォールバック
      if (pendingConsentFallback) {
        pendingConsentFallback = false;
        console.log("prompt なしでの認証が失敗、consent 画面にフォールバックします");
        tokenClient?.requestAccessToken({ prompt: "consent" });
        return;
      }
      // リトライ可能ならスケジュール
      if (refreshRetryCount < MAX_REFRESH_RETRIES) {
        console.log(`サイレントリフレッシュをリトライします (${refreshRetryCount}/${MAX_REFRESH_RETRIES})`);
        refreshTimerId = setTimeout(() => {
          refreshTimerId = null;
          attemptSilentRefresh();
        }, REFRESH_RETRY_INTERVAL_MS);
      }
      resolveSilentRefresh?.();
      resolveSilentRefresh = null;
    },
  });

  // タブのフォアグラウンド復帰時にトークンをチェック
  document.addEventListener("visibilitychange", handleVisibilityChange);

  if (authState.accessToken) {
    // 有効なトークンがある → リスナーに通知 + 自動更新タイマーをセット
    scheduleTokenRefresh(authState.expiresAt);
    authListeners.forEach((fn) => fn(authState.accessToken));
  } else if (needsSilentRefresh) {
    // トークン期限切れだが以前ログイン済み → ポップアップなしでトークン再取得
    const silentRefreshPromise = new Promise<void>((resolve) => {
      resolveSilentRefresh = resolve;
    });
    tokenClient.requestAccessToken({ prompt: "" });
    await Promise.race([
      silentRefreshPromise,
      new Promise<void>((resolve) => setTimeout(resolve, SILENT_REFRESH_TIMEOUT_MS)),
    ]);
  }
}

function setAuthState(token: string | null, expiresAt: number | null) {
  authState = { accessToken: token, expiresAt };
  saveToStorage(authState);
  scheduleTokenRefresh(expiresAt);
  authListeners.forEach((fn) => fn(token));
}

// サイレントリフレッシュを実行（リトライ付き）
function attemptSilentRefresh() {
  if (!tokenClient) return;
  refreshRetryCount++;
  tokenClient.requestAccessToken({ prompt: "" });
}

// トークン期限切れ前に自動更新をスケジュール
function scheduleTokenRefresh(expiresAt: number | null) {
  // 既存タイマーをクリア
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  // リフレッシュ成功時はリトライカウントをリセット
  if (expiresAt) refreshRetryCount = 0;

  if (!expiresAt || !tokenClient) return;

  const delay = expiresAt - Date.now() - REFRESH_MARGIN_MS;
  if (delay <= 0) return;

  refreshTimerId = setTimeout(() => {
    refreshTimerId = null;
    attemptSilentRefresh();
  }, delay);
}

// タブがフォアグラウンドに戻った時にトークン状態をチェック
function handleVisibilityChange() {
  if (document.visibilityState !== "visible") return;
  if (isTauri() || !tokenClient || !hasPreviousConsent()) return;

  // トークンが既に期限切れ → 即リフレッシュ
  if (!authState.accessToken || !authState.expiresAt) {
    attemptSilentRefresh();
    return;
  }

  // 期限切れ間近（残り REFRESH_MARGIN_MS 以内）→ 即リフレッシュ
  const remaining = authState.expiresAt - Date.now();
  if (remaining < REFRESH_MARGIN_MS) {
    attemptSilentRefresh();
    return;
  }

  // タイマーが消えている場合（バックグラウンドで停止された）→ 再スケジュール
  if (refreshTimerId === null) {
    scheduleTokenRefresh(authState.expiresAt);
  }
}

// 認証エラーのリスナー
let authErrorListeners: Array<(error: string) => void> = [];
export function onAuthError(fn: (error: string) => void): () => void {
  authErrorListeners.push(fn);
  return () => { authErrorListeners = authErrorListeners.filter((l) => l !== fn); };
}
function emitAuthError(error: string) {
  authErrorListeners.forEach((fn) => fn(error));
}

// サインイン
export function signIn(): void {
  if (isTauri()) {
    desktop.signInDesktop().catch((e) => {
      console.error("Desktop OAuth error:", e);
      emitAuthError(e instanceof Error ? e.message : String(e));
    });
    return;
  }

  // セルフホスト環境: PKCE フロー
  if (webPkce.isPkceAvailable()) {
    webPkce.signInPkce().catch((e) => {
      console.error("Web PKCE OAuth error:", e);
      emitAuthError(e instanceof Error ? e.message : String(e));
    });
    return;
  }

  // モバイル: ポップアップが動作しないため、リダイレクト方式を使用
  if (isMobile()) {
    localStorage.setItem(REDIRECT_PENDING_KEY, "true");
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: getRedirectUri(),
      response_type: "token",
      scope: SCOPES,
      prompt: "consent",
      include_granted_scopes: "true",
    });
    window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
    return;
  }

  // デスクトップブラウザ: GIS SDK ポップアップ方式
  if (!tokenClient) {
    console.error("Google 認証が初期化されていません");
    return;
  }

  // 以前ログイン済みのユーザー → prompt なしでまず試行（同意画面をスキップ）
  // 初回ユーザー → consent 画面を表示してスコープ同意を取得
  if (hasPreviousConsent()) {
    pendingConsentFallback = true;
    tokenClient.requestAccessToken({ prompt: "" });
  } else {
    tokenClient.requestAccessToken({ prompt: "consent" });
  }
}

// サインアウト
export function signOut(): void {
  if (isTauri()) { desktop.signOutDesktop(); return; }
  if (webPkce.isPkceAvailable()) { webPkce.signOutPkce(); return; }
  if (authState.accessToken) {
    const token = authState.accessToken;
    fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: "POST",
    }).catch(() => {});
  }
  // 同意済みフラグもクリア（次回起動時にサイレントリフレッシュしない）
  localStorage.removeItem(HAS_CONSENTED_KEY);
  setAuthState(null, null);
}

// 現在のアクセストークンを取得（期限切れならnull）
export function getAccessToken(): string | null {
  if (isTauri()) return desktop.getAccessToken();
  if (webPkce.isPkceAvailable()) return webPkce.getAccessToken();
  if (!authState.accessToken || !authState.expiresAt) return null;
  if (Date.now() >= authState.expiresAt) {
    setAuthState(null, null);
    return null;
  }
  return authState.accessToken;
}

// 認証状態が変わったときのリスナー
export function onAuthChange(fn: (token: string | null) => void): () => void {
  if (isTauri()) return desktop.onAuthChange(fn);
  if (webPkce.isPkceAvailable()) return webPkce.onAuthChange(fn);
  authListeners.push(fn);
  return () => {
    authListeners = authListeners.filter((l) => l !== fn);
  };
}

// 認証済みかどうか
export function isSignedIn(): boolean {
  if (isTauri()) return desktop.isSignedIn();
  if (webPkce.isPkceAvailable()) return webPkce.isSignedIn();
  return getAccessToken() !== null;
}
