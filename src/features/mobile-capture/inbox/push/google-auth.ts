// Google Identity Services (GIS) token model による認可。
//
// 方式は 2 つある（config.ts の resolveAuthMode が選ぶ）:
// - hourly: popup 型 token client（client_id のみ・secret なし）。SPA には refresh token が
//   出ないため、アクセストークンは約 1 時間で失効する。失効時の UX は queue.ts の
//   store-and-forward が吸収する（ここでは有効期限の追跡と失効検知だけを担う）。
// - stay（つないだまま）: GIS の code model（popup）で authorization code を受け取り、
//   token broker（Cloudflare Worker）の /exchange で refresh token に替える。以後は
//   broker の /refresh で画面なしにアクセストークンを取り直す。client_id は hourly と
//   別プロジェクト（理由は config.ts の DEFAULT_GOOGLE_STAY_CLIENT_ID）。
//   トークン・code は console に出さず、エラーメッセージにも含めない。
// - gsi スクリプト（https://accounts.google.com/gsi/client）は動的ロード。
//   起動時バンドルには入れない（push/ は UI から動的 import される前提）。
// - **requestAccessToken（stay は requestCode）はユーザージェスチャ直下で同期的に呼ぶ必要がある**。
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
import { getStayConnectedConfig, type PushAuthMode } from "./config";
import { PushAuthError, PushConfigError } from "./types";

const GSI_SRC = "https://accounts.google.com/gsi/client";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_STORAGE_KEY = "graphium-push-google-token";
/** stay 方式の保存キー（{ refreshToken?, accessToken?, expiresAt? }）。 */
const STAY_STORAGE_KEY = "graphium-push-google-stay";
/** broker への fetch のタイムアウト。 */
const BROKER_TIMEOUT_MS = 15 * 1000;
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

type GsiCodeResponse = {
  code?: string;
  error?: string;
  error_description?: string;
};

type GsiCodeClient = {
  requestCode: () => void;
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
          initCodeClient: (config: {
            client_id: string;
            scope: string;
            ux_mode: "popup";
            callback: (response: GsiCodeResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => GsiCodeClient;
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

/** stay 方式の保存内容。 */
type StayStored = {
  refreshToken?: string;
  accessToken?: string;
  /** epoch ms。 */
  expiresAt?: number;
};

let gsiLoadPromise: Promise<void> | null = null;
let tokenClient: GsiTokenClient | null = null;
let initializedClientId: string | null = null;
let codeClient: GsiCodeClient | null = null;
let initializedCodeClientId: string | null = null;
/** 直近に prepare した方式。connectInteractive はこれで hourly / stay を分ける。 */
let preparedMode: PushAuthMode = "hourly";
/**
 * 接続の世代。disconnectGoogleAuth で進める。進行中の要求（code 交換・取り直し・hourly の
 * callback）は開始時の世代を覚え、保存の直前に変わっていたら保存しない
 * （切断を押したのに接続が復活しないように）。
 */
let connectionGeneration = 0;
/** 進行中の stay のアクセストークン取り直し（同時呼び出しは 1 本にまとめる）。 */
let refreshInFlight: Promise<string | null> | null = null;
/** 進行中のトークン要求（二重タップは同じ Promise を返す）。 */
let pendingRequest: {
  /** 要求開始時の接続の世代。切断で世代が進んだら、届いたトークンは保存しない。 */
  generation: number;
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
  if (pending.generation !== connectionGeneration) {
    // 要求中に切断された: 届いたトークンは保存せず revoke（ベストエフォート）
    revokeToken(response.access_token);
    pending.reject(new PushAuthError("Disconnected while signing in"));
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
 * 認可の準備（gsi ロード + token client / code client 初期化）。ポップアップは出さない。
 * 冪等 — 同じ client_id・同じ方式なら 2 回目以降は即 resolve。client_id か方式が
 * 変わったら作り直す（自前 client_id の上書き反映・方式切り替え）。
 */
export async function prepareGoogleAuth(clientId: string, mode: PushAuthMode = "hourly"): Promise<void> {
  if (!clientId || clientId.trim() === "") {
    throw new PushConfigError("Google client ID is not configured");
  }
  if (mode === "stay" ? codeClient && initializedCodeClientId === clientId : tokenClient && initializedClientId === clientId) {
    preparedMode = mode;
    return;
  }
  await loadGsiScript();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error("Google Identity Services is unavailable after script load");
  }
  if (mode === "stay") {
    codeClient = oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPE,
      ux_mode: "popup",
      callback: handleCodeResponse,
      error_callback: handleTokenError,
    });
    initializedCodeClientId = clientId;
  } else {
    tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: handleTokenResponse,
      error_callback: handleTokenError,
    });
    initializedClientId = clientId;
  }
  preparedMode = mode;
}

/** prepareGoogleAuth 済みか（connect ボタンの活性判定に使える）。 */
export function isAuthPrepared(): boolean {
  return preparedMode === "stay" ? codeClient !== null : tokenClient !== null;
}

/**
 * トークンを対話的に取得する。**ユーザージェスチャのハンドラから同期的に呼ぶこと**
 * （この関数は最初の await を挟まずに requestAccessToken を呼ぶ）。
 * prepareGoogleAuth が済んでいなければ PushConfigError で reject する —
 * ここで SDK ロードを await すると iOS でポップアップがブロックされるため、
 * 遅延準備には決してフォールバックしない。
 */
export function connectInteractive(): Promise<string> {
  if (preparedMode === "stay") return connectInteractiveStay();
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
  pendingRequest = { generation: connectionGeneration, promise, resolve, reject };
  // prompt を指定しない: 既に同意済みのアカウントなら Google 側が確認を最小化する
  tokenClient.requestAccessToken({ prompt: "" });
  return promise;
}

/**
 * stay 方式の対話接続。hourly と同じく **最初の await より前に** requestCode を同期で呼ぶ。
 * code を受けたら broker の /exchange で交換して保存する（その間も二重タップは同じ要求に相乗り）。
 */
function connectInteractiveStay(): Promise<string> {
  if (!codeClient) {
    return Promise.reject(
      new PushConfigError("Google auth is not prepared; call prepareGoogleAuth() first"),
    );
  }
  if (pendingRequest) return pendingRequest.promise;
  let resolve!: (token: string) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  pendingRequest = { generation: connectionGeneration, promise, resolve, reject };
  codeClient.requestCode();
  return promise;
}

function handleCodeResponse(response: GsiCodeResponse): void {
  const pending = pendingRequest;
  if (!pending) return; // 想定外の callback（要求していない）は無視
  if (response.error || !response.code) {
    pendingRequest = null;
    pending.reject(
      new PushAuthError(response.error_description ?? response.error ?? "No authorization code returned"),
    );
    return;
  }
  void exchangeCode(response.code, pending.generation).then(
    (token) => {
      pendingRequest = null;
      pending.resolve(token);
    },
    (err) => {
      pendingRequest = null;
      pending.reject(err);
    },
  );
}

// ── stay: 保存と broker 呼び出し ──

function loadStayStored(): StayStored | null {
  try {
    const raw = localStorage.getItem(STAY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StayStored;
    const out: StayStored = {};
    if (typeof parsed.refreshToken === "string" && parsed.refreshToken) out.refreshToken = parsed.refreshToken;
    if (typeof parsed.accessToken === "string" && parsed.accessToken) out.accessToken = parsed.accessToken;
    if (typeof parsed.expiresAt === "number") out.expiresAt = parsed.expiresAt;
    return out;
  } catch {
    return null;
  }
}

function saveStayStored(value: StayStored | null): void {
  try {
    if (value === null || (!value.refreshToken && !value.accessToken)) {
      localStorage.removeItem(STAY_STORAGE_KEY);
    } else {
      localStorage.setItem(STAY_STORAGE_KEY, JSON.stringify(value));
    }
  } catch {
    // localStorage 不可でも致命的にしない
  }
  emitPushStatusChanged();
}

type BrokerTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
};

/** broker が返したエラー（invalid_grant かどうかを呼び出し側が見る）。トークンは含めない。 */
class BrokerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Token broker error (${status}${code ? `: ${code}` : ""})`);
    this.name = "BrokerHttpError";
  }
}

/** broker へ JSON を POST する。15 秒で打ち切る。通信失敗は PushAuthError。 */
async function brokerPost(
  brokerUrl: string,
  path: "/exchange" | "/refresh",
  body: Record<string, string>,
): Promise<BrokerTokenResponse> {
  const controller = new AbortController();
  // 応答本文の読み出しが終わるまでタイマーを生かす（本文が来ないまま固まると
  // refreshInFlight が解けないため）
  const timer = setTimeout(() => controller.abort(), BROKER_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(`${brokerUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Requested-With": "graphium" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      throw new PushAuthError("Token broker is unreachable");
    }
    if (!res.ok) {
      let code = "";
      try {
        const j = (await res.json()) as { error?: unknown };
        if (typeof j.error === "string") code = j.error;
      } catch {
        // 本文が JSON でなくても status だけで扱う
      }
      throw new BrokerHttpError(res.status, code);
    }
    try {
      return (await res.json()) as BrokerTokenResponse;
    } catch {
      throw new PushAuthError("Token broker returned an invalid response");
    }
  } finally {
    clearTimeout(timer);
  }
}

function expiresAtFrom(expiresIn: unknown): number {
  const sec = Number(expiresIn ?? 0);
  return Date.now() + (Number.isFinite(sec) ? sec : 0) * 1000;
}

/** authorization code を broker で交換して保存する。refresh_token が無くてもアクセストークンは保存して成功。 */
async function exchangeCode(code: string, generation: number): Promise<string> {
  const config = getStayConnectedConfig();
  if (!config) throw new PushConfigError("Stay-connected is not configured");
  let data: BrokerTokenResponse;
  try {
    data = await brokerPost(config.brokerUrl, "/exchange", { code });
  } catch (err) {
    if (err instanceof BrokerHttpError) throw new PushAuthError(err.message);
    throw err;
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new PushAuthError("Token broker returned no access token");
  }
  if (generation !== connectionGeneration) {
    // 交換の間に切断された: 保存せず、受け取った鍵を revoke（ベストエフォート）して失敗にする
    revokeToken(typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : data.access_token);
    throw new PushAuthError("Disconnected while signing in");
  }
  saveStayStored({
    accessToken: data.access_token,
    expiresAt: expiresAtFrom(data.expires_in),
    ...(typeof data.refresh_token === "string" && data.refresh_token
      ? { refreshToken: data.refresh_token }
      : {}),
  });
  return data.access_token;
}

/** refresh token でアクセストークンを取り直す（呼び出し側が同時実行を 1 本にまとめる）。 */
async function refreshStayToken(refreshToken: string, generation: number): Promise<string | null> {
  const config = getStayConnectedConfig();
  if (!config) return null;
  let data: BrokerTokenResponse;
  try {
    data = await brokerPost(config.brokerUrl, "/refresh", { refresh_token: refreshToken });
  } catch (err) {
    if (err instanceof BrokerHttpError && err.status === 400 && err.code === "invalid_grant") {
      // 失効・取り消し: 保存を全部捨てて「つなぎ直し」にする。ただし保存されているのが
      // 自分の使った refresh token のときだけ（別の新しい接続を消さない）
      if (generation === connectionGeneration && loadStayStored()?.refreshToken === refreshToken) {
        saveStayStored(null);
      }
      return null;
    }
    // 一時的な不調（通信失敗・5xx・429・403 等）: refresh token は残して次の機会に任せる
    if (err instanceof BrokerHttpError) throw new PushAuthError(err.message);
    throw err;
  }
  if (typeof data.access_token !== "string" || !data.access_token) {
    throw new PushAuthError("Token broker returned no access token");
  }
  // 取り直しの間に切断された場合は保存を復活させない
  if (generation !== connectionGeneration || loadStayStored()?.refreshToken !== refreshToken) return null;
  saveStayStored({
    refreshToken,
    accessToken: data.access_token,
    expiresAt: expiresAtFrom(data.expires_in),
  });
  return data.access_token;
}

/**
 * push に使う有効なアクセストークンを返す（無ければ null = つなぎ直し）。
 * - hourly: 従来の getValidAccessToken（期限内の保存トークンだけ）
 * - stay: 期限内ならそれ、無ければ refresh token で broker /refresh。
 *   broker の一時的な不調は PushAuthError（refresh token は残す）。
 */
export async function getFreshAccessToken(mode: PushAuthMode): Promise<string | null> {
  if (mode === "hourly") return getValidAccessToken();
  const stored = loadStayStored();
  if (!stored) return null;
  if (
    stored.accessToken &&
    stored.expiresAt !== undefined &&
    Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS
  ) {
    return stored.accessToken;
  }
  if (!stored.refreshToken) {
    // 期限切れで refresh token も無い: つなぎ直し。残骸は捨てる
    if (stored.accessToken) saveStayStored(null);
    return null;
  }
  if (!refreshInFlight) {
    const refreshToken = stored.refreshToken;
    refreshInFlight = refreshStayToken(refreshToken, connectionGeneration).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** 今すぐ（または画面なしで）push できる認証があるか。同期・副作用なし（stay）。 */
export function hasGoogleConnection(mode: PushAuthMode): boolean {
  if (mode === "hourly") return getValidAccessToken() !== null;
  const stored = loadStayStored();
  if (!stored) return false;
  if (stored.refreshToken) return true;
  return (
    !!stored.accessToken &&
    stored.expiresAt !== undefined &&
    Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS
  );
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
 * 保存済みアクセストークンを破棄する（revoke はしない）。
 * Drive API が 401 を返したとき（手元の期限より Google 側の判定が正）に呼ぶ。
 * stay では accessToken と expiresAt だけ捨て、refresh token は残す（次の送信で取り直す）。
 */
export function invalidateAccessToken(mode: PushAuthMode = "hourly"): void {
  if (mode === "stay") {
    const stored = loadStayStored();
    saveStayStored(stored?.refreshToken ? { refreshToken: stored.refreshToken } : null);
    return;
  }
  saveStoredToken(null);
}

/** トークンを revoke する（ベストエフォート・fire-and-forget。失敗しても手元は消す）。 */
function revokeToken(token: string): void {
  fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
    method: "POST",
  }).catch(() => {});
}

/** 切断: 両方式の保存を revoke（ベストエフォート）して破棄する。 */
export function disconnectGoogleAuth(): void {
  connectionGeneration++; // 進行中の要求が切断後に保存しないようにする
  const stored = loadStoredToken();
  if (stored) revokeToken(stored.accessToken);
  saveStoredToken(null);
  const stay = loadStayStored();
  if (stay) {
    const token = stay.refreshToken ?? stay.accessToken;
    if (token) revokeToken(token);
    saveStayStored(null);
  }
}
