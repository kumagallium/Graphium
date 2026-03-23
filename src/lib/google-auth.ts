// Google Identity Services (GIS) による認証
// クライアントIDは環境変数から取得（VITE_GOOGLE_CLIENT_ID）

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
const SCOPES = "https://www.googleapis.com/auth/drive.file";
const STORAGE_KEY = "provnote_auth";

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

let tokenClient: TokenClient | null = null;
let authState: AuthState = loadFromStorage();
let authListeners: Array<(token: string | null) => void> = [];

// sessionStorage からトークンを復元
function loadFromStorage(): AuthState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { accessToken: null, expiresAt: null };
    const stored = JSON.parse(raw) as AuthState;
    // 期限切れチェック
    if (stored.expiresAt && Date.now() < stored.expiresAt) {
      return stored;
    }
  } catch {}
  return { accessToken: null, expiresAt: null };
}

// sessionStorage にトークンを保存
function saveToStorage(state: AuthState) {
  if (state.accessToken) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
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

// 初期化
export async function initGoogleAuth(): Promise<void> {
  if (!CLIENT_ID) {
    console.warn("VITE_GOOGLE_CLIENT_ID が設定されていません");
    return;
  }
  await loadGisScript();

  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (response.error) {
        console.error("Google 認証エラー:", response.error);
        setAuthState(null, null);
        return;
      }
      const expiresAt = Date.now() + response.expires_in * 1000;
      setAuthState(response.access_token, expiresAt);
    },
    error_callback: (error) => {
      console.error("Google 認証エラー:", error);
    },
  });

  // sessionStorage に有効なトークンがあればリスナーに通知
  if (authState.accessToken) {
    authListeners.forEach((fn) => fn(authState.accessToken));
  }
}

function setAuthState(token: string | null, expiresAt: number | null) {
  authState = { accessToken: token, expiresAt };
  saveToStorage(authState);
  authListeners.forEach((fn) => fn(token));
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
