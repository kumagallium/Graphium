// Google Identity Services (GIS) による認証
// クライアントIDは環境変数 → 組み込みデフォルト の優先順で取得

const DEFAULT_CLIENT_ID =
  "743366655410-p5k3us8jof0ni4tintbkliq6dqhan13d.apps.googleusercontent.com";
const CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || DEFAULT_CLIENT_ID;

const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const STORAGE_KEY = "provnote_auth";
// 以前ログインに成功した記録（サイレントリフレッシュ判定用）
const HAS_CONSENTED_KEY = "provnote_has_consented";

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

let tokenClient: TokenClient | null = null;
let authState: AuthState = loadFromStorage();
let authListeners: Array<(token: string | null) => void> = [];
let refreshTimerId: ReturnType<typeof setTimeout> | null = null;

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
  if (!CLIENT_ID) {
    console.warn("Google OAuth Client ID が設定されていません");
    return;
  }
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
        setAuthState(null, null);
      } else {
        const expiresAt = Date.now() + response.expires_in * 1000;
        setAuthState(response.access_token, expiresAt);
      }
      // サイレントリフレッシュ待ちを解除
      resolveSilentRefresh?.();
      resolveSilentRefresh = null;
    },
    error_callback: (error) => {
      console.error("Google 認証エラー:", error);
      // サイレントリフレッシュ失敗 → ログイン画面へ
      resolveSilentRefresh?.();
      resolveSilentRefresh = null;
    },
  });

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

// トークン期限切れ前に自動更新をスケジュール
function scheduleTokenRefresh(expiresAt: number | null) {
  // 既存タイマーをクリア
  if (refreshTimerId !== null) {
    clearTimeout(refreshTimerId);
    refreshTimerId = null;
  }
  if (!expiresAt || !tokenClient) return;

  const delay = expiresAt - Date.now() - REFRESH_MARGIN_MS;
  if (delay <= 0) return; // 既に余裕がない場合はスキップ

  refreshTimerId = setTimeout(() => {
    refreshTimerId = null;
    // prompt: "" で同意済みユーザーはポップアップなしで更新
    tokenClient?.requestAccessToken({ prompt: "" });
  }, delay);
}

// サインイン（ポップアップ表示）
export function signIn(): void {
  if (!tokenClient) {
    console.error("Google 認証が初期化されていません");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "consent" });
}

// サインアウト
export function signOut(): void {
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
  if (!authState.accessToken || !authState.expiresAt) return null;
  if (Date.now() >= authState.expiresAt) {
    setAuthState(null, null);
    return null;
  }
  return authState.accessToken;
}

// 認証状態が変わったときのリスナー
export function onAuthChange(fn: (token: string | null) => void): () => void {
  authListeners.push(fn);
  return () => {
    authListeners = authListeners.filter((l) => l !== fn);
  };
}

// 認証済みかどうか
export function isSignedIn(): boolean {
  return getAccessToken() !== null;
}
