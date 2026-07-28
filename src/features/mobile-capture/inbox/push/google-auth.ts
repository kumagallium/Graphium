// Google Identity Services (GIS) token model による認可。
//
// - popup 型 token client（client_id のみ・secret なし）。SPA には refresh token が
//   出ないため、アクセストークンは約 1 時間で失効する。失効時の UX は queue.ts の
//   store-and-forward が吸収する（ここでは有効期限の追跡と失効検知だけを担う）。
// - gsi スクリプト（https://accounts.google.com/gsi/client）は動的ロード。
//   起動時バンドルには入れない（push/ は UI から動的 import される前提）。
// - **requestAccessToken はユーザージェスチャ直下で同期的に呼ぶ必要がある**。
//   そのため「非同期の準備（prepareGoogleAuth）」と「同期開始のトークン要求
//   （connectInteractive）」を分離している。connectInteractive は最初の await より
//   前に requestAccessToken を呼ぶ構造で、準備が済んでいなければ即 reject する。
// - トークンは localStorage に保存する。PWA はすぐ殺されるので、メモリ保持だけだと
//   「撮る → アプリを離れる → 戻って送る」で毎回ポップアップになる。期限内なら
//   再利用し、期限切れは読み出し時に破棄する。
//
// 旧実装（4608875~1:src/lib/google-auth.ts）の GIS 部分を下敷きにしたが、
// PKCE/デスクトップ分岐・サイレントリフレッシュは持ち込まない（push 専用に最小化）。

import { emitPushStatusChanged } from "../push-events";
import { PushAuthError, PushConfigError } from "./types";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_STORAGE_KEY = "graphium-push-google-token";
/** 期限ぎりぎりのトークンでアップロードを始めないための余裕。 */
const EXPIRY_MARGIN_MS = 60 * 1000;

// GIS SDK のグローバル型（このモジュールに閉じる最小限）
type GsiTokenResponse = {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
};

type GsiTokenClient = {
  requestAccessToken: (overrides?: { prompt?: string }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GsiTokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => GsiTokenClient;
        };
      };
    };
  }
}

type StoredToken = {
  accessToken: string;
  /** epoch ms。 */
  expiresAt: number;
};

let gsiLoadPromise: Promise<void> | null = null;
let tokenClient: GsiTokenClient | null = null;
let initializedClientId: string | null = null;
/** 進行中のトークン要求（二重タップは同じ Promise を返す）。 */
let pendingRequest: {
  promise: Promise<string>;
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
} | null = null;

function loadStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof parsed.accessToken === "string" && typeof parsed.expiresAt === "number") {
      return { accessToken: parsed.accessToken, expiresAt: parsed.expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

function saveStoredToken(token: StoredToken | null): void {
  try {
    if (token === null) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
    }
  } catch {
    // localStorage 不可でも致命的にしない（セッション内はポップアップで都度取得できる）
  }
  // 接続・切断・失効破棄を（設定モーダル/ホームの）他の購読面に伝える。
  // ループ安全: 受け手の refreshStatus → getValidAccessToken は、失効分を一度
  // 破棄した後は null 早期 return になり、ここへ再帰しない。
  emitPushStatusChanged();
}

/** gsi スクリプトを動的ロードする（冪等）。 */
function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gsiLoadPromise) return gsiLoadPromise;
  gsiLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GSI_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gsiLoadPromise = null; // 次回また試せるように
      reject(new Error("Failed to load Google Identity Services script"));
    };
    document.head.appendChild(script);
  });
  return gsiLoadPromise;
}

function handleTokenResponse(response: GsiTokenResponse): void {
  const pending = pendingRequest;
  pendingRequest = null;
  if (!pending) return; // 想定外の callback（要求していない）は無視
  if (response.error || !response.access_token) {
    pending.reject(
      new PushAuthError(response.error_description ?? response.error ?? "No access token returned"),
    );
    return;
  }
  const expiresInSec = Number(response.expires_in ?? 0);
  const expiresAt = Date.now() + (Number.isFinite(expiresInSec) ? expiresInSec : 0) * 1000;
  saveStoredToken({ accessToken: response.access_token, expiresAt });
  pending.resolve(response.access_token);
}

function handleTokenError(error: { type?: string; message?: string }): void {
  const pending = pendingRequest;
  pendingRequest = null;
  if (!pending) return;
  pending.reject(new PushAuthError(error.message ?? error.type ?? "Google auth failed"));
}

/**
 * 認可の準備（gsi ロード + token client 初期化）。ポップアップは出さない。
 * 冪等 — 同じ client_id なら 2 回目以降は即 resolve。client_id が変わったら
 * 作り直す（自前 client_id の上書き反映）。
 */
export async function prepareGoogleAuth(clientId: string): Promise<void> {
  if (!clientId || clientId.trim() === "") {
    throw new PushConfigError("Google client ID is not configured");
  }
  if (tokenClient && initializedClientId === clientId) return;
  await loadGsiScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google Identity Services is unavailable after script load");
  }
  tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: handleTokenResponse,
    error_callback: handleTokenError,
  });
  initializedClientId = clientId;
}

/** prepareGoogleAuth 済みか（connect ボタンの活性判定に使える）。 */
export function isAuthPrepared(): boolean {
  return tokenClient !== null;
}

/**
 * トークンを対話的に取得する。**ユーザージェスチャのハンドラから同期的に呼ぶこと**
 * （この関数は最初の await を挟まずに requestAccessToken を呼ぶ）。
 * prepareGoogleAuth が済んでいなければ PushConfigError で reject する —
 * ここで SDK ロードを await すると iOS でポップアップがブロックされるため、
 * 遅延準備には決してフォールバックしない。
 */
export function connectInteractive(): Promise<string> {
  if (!tokenClient) {
    return Promise.reject(
      new PushConfigError("Google auth is not prepared; call prepareGoogleAuth() first"),
    );
  }
  if (pendingRequest) return pendingRequest.promise; // 二重タップは同じ要求に相乗り
  let resolve!: (token: string) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingRequest = { promise, resolve, reject };
  // prompt を指定しない: 既に同意済みのアカウントなら Google 側が確認を最小化する
  tokenClient.requestAccessToken({ prompt: "" });
  return promise;
}

/** 有効期限内（余裕込み）のアクセストークン。無ければ null（失効分は破棄する）。 */
export function getValidAccessToken(): string | null {
  const stored = loadStoredToken();
  if (!stored) return null;
  if (Date.now() >= stored.expiresAt - EXPIRY_MARGIN_MS) {
    saveStoredToken(null);
    return null;
  }
  return stored.accessToken;
}

/**
 * 保存済みトークンを破棄する（revoke はしない）。
 * Drive API が 401 を返したとき（手元の期限より Google 側の判定が正）に呼ぶ。
 */
export function invalidateAccessToken(): void {
  saveStoredToken(null);
}

/** 切断: トークンを revoke（ベストエフォート）して破棄する。 */
export function disconnectGoogleAuth(): void {
  const stored = loadStoredToken();
  if (stored) {
    // fire-and-forget。失敗しても手元のトークンは消す。
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.accessToken)}`, {
      method: "POST",
    }).catch(() => {});
  }
  saveStoredToken(null);
}
