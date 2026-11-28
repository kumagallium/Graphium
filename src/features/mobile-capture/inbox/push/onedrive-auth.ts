// 個人の Microsoft アカウントの OneDrive 向け認可（認可コード + PKCE の自前実装）。
//
// - Microsoft のスクリプト（MSAL 等）は読み込まない。認可先と /token を直接叩く。
//   client_id のみ・secret なし（SPA 用の公開クライアント）。
// - **window.open はユーザージェスチャ直下で同期的に呼ぶ必要がある**（iOS の制約）。
//   PKCE の code_verifier / code_challenge（crypto.subtle は非同期）と state は、
//   タップより前に prepareOneDriveAuth で作ってメモリに持つ。connectInteractive は
//   最初の await より前に window.open まで到達し、準備が済んでいなければ即 reject する
//   （google-auth.ts の connectInteractive と同じ契約）。
// - 戻り先はアプリと同じオリジンの静的ページ（public/app/auth/onedrive.html）。
//   そこが URL の fragment から code / state を読み、同一オリジンの BroadcastChannel
//   （と window.opener への postMessage）で渡す。検証（state 一致）はこちら側でやる。
// - Microsoft の SPA 向けの更新用の鍵（refresh_token）は発行から 24 時間固定で、
//   更新しても延びない。refreshExpiresAt は「対話でつないだ時刻 + 24 時間」で持ち、
//   更新時は新しい refresh_token を保存しても据え置く。
// - 失効 API は無いので、切断は端末の鍵と印を消すだけ。
// - 鍵・コード・state を console に出さない。

import { emitPushStatusChanged } from "../push-events";
import { getOneDriveClientId } from "./config";
import { PushAuthError, PushConfigError } from "./types";

const AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE = "Files.ReadWrite.AppFolder offline_access";
const TOKEN_STORAGE_KEY = "graphium-push-onedrive-token";
/** 「以前つないだことがある」印。切断（disconnectOneDriveAuth）でだけ消す。 */
const LINKED_STORAGE_KEY = "graphium-push-onedrive-linked";
/** 戻り先ページ（public/app/auth/onedrive-return.js）と揃える。 */
export const ONEDRIVE_AUTH_CHANNEL = "graphium-onedrive-auth";
/** 期限ぎりぎりのトークンでアップロードを始めないための余裕。 */
const EXPIRY_MARGIN_MS = 60 * 1000;
/** 更新用の鍵の寿命（Microsoft の SPA は 24 時間固定）。 */
const REFRESH_LIFETIME_MS = 24 * 60 * 60 * 1000;
/** 認可の窓を開いたまま待つ上限。 */
const CONNECT_TIMEOUT_MS = 10 * 60 * 1000;
/** 窓が閉じたことを見つけてから、戻りのメッセージを待つ猶予。 */
const CLOSED_GRACE_MS = 1000;
const CLOSED_POLL_MS = 500;

type StoredToken = {
  accessToken: string;
  /** epoch ms。 */
  expiresAt: number;
  refreshToken: string;
  /** epoch ms。対話でつないだ時刻 + 24 時間（更新しても延びない）。 */
  refreshExpiresAt: number;
};

type PreparedAuth = {
  clientId: string;
  codeVerifier: string;
  codeChallenge: string;
  state: string;
};

type AuthMessage = {
  type?: string;
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
};

let prepared: PreparedAuth | null = null;
let preparing: Promise<void> | null = null;
let preparingClientId: string | null = null;
/** 進行中の対話接続（二重タップは同じ Promise を返す）。 */
let pendingConnect: Promise<void> | null = null;
/** 切断のたびに進める世代。切断より前に始まった接続が、あとから鍵を保存しないようにする。 */
let authEpoch = 0;
/** 進行中の更新（単一飛行）。 */
let refreshInFlight: Promise<string | null> | null = null;

// ── PKCE の部品 ──

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return base64Url(new Uint8Array(digest));
}

/** 戻り先 URL（Microsoft 側のアプリ登録と完全一致させる固定値）。 */
export function getOneDriveRedirectUri(): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL("app/auth/onedrive.html", new URL(base, window.location.origin)).toString();
}

// ── 保存 ──

function loadStoredToken(): StoredToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredToken>;
    if (
      typeof p.accessToken === "string" &&
      typeof p.expiresAt === "number" &&
      typeof p.refreshToken === "string" &&
      typeof p.refreshExpiresAt === "number"
    ) {
      return {
        accessToken: p.accessToken,
        expiresAt: p.expiresAt,
        refreshToken: p.refreshToken,
        refreshExpiresAt: p.refreshExpiresAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveStoredToken(token: StoredToken | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token));
  } catch {
    // localStorage 不可でも致命的にしない（その都度つなぎ直せる）
  }
  // 接続・切断・失効破棄を他の購読面へ伝える。受け手が読む isConnected は
  // 保存値を読むだけなので、ここへ再帰しない。
  emitPushStatusChanged();
}

function markLinked(): void {
  try {
    localStorage.setItem(LINKED_STORAGE_KEY, "1");
  } catch {
    // 非致命的
  }
}

function clearLinked(): void {
  try {
    localStorage.removeItem(LINKED_STORAGE_KEY);
  } catch {
    // 非致命的
  }
}

/** 以前この端末で OneDrive につないだことがあるか。 */
export function hasLinkedBefore(): boolean {
  try {
    return localStorage.getItem(LINKED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** 更新用の鍵が期限内か（= 今すぐ push を始められる見込みがあるか）。同期・副作用なし。 */
export function isConnected(): boolean {
  const stored = loadStoredToken();
  return stored !== null && stored.refreshToken !== "" && Date.now() < stored.refreshExpiresAt;
}

/** 更新用の鍵の期限までの残り ms（負もありうる）。鍵が無ければ null。純粋な読み取り。 */
export function getRefreshRemainingMs(): number | null {
  const stored = loadStoredToken();
  if (!stored) return null;
  return stored.refreshExpiresAt - Date.now();
}

// ── 準備（タップの前に済ませる） ──

/**
 * PKCE の組（verifier / challenge）と state を作ってメモリに持つ。ウィンドウは開かない。
 * 冪等 — 同じ client_id で準備済みなら即 resolve。client_id が変わったら作り直す。
 */
export function prepareOneDriveAuth(clientId: string): Promise<void> {
  if (!clientId || clientId.trim() === "") {
    return Promise.reject(new PushConfigError("OneDrive client ID is not configured"));
  }
  if (prepared && prepared.clientId === clientId) return Promise.resolve();
  if (preparing && preparingClientId === clientId) return preparing;
  preparingClientId = clientId;
  const job = (async () => {
    const codeVerifier = randomBase64Url(32);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const state = randomBase64Url(16);
    prepared = { clientId, codeVerifier, codeChallenge, state };
  })().finally(() => {
    if (preparing === job) {
      preparing = null;
      preparingClientId = null;
    }
  });
  preparing = job;
  return job;
}

/** prepareOneDriveAuth 済みか（connect を同期で呼べるか）。 */
export function isOneDriveAuthPrepared(): boolean {
  return prepared !== null;
}

// ── 対話接続 ──

function buildAuthorizeUrl(p: PreparedAuth): string {
  const params = new URLSearchParams({
    client_id: p.clientId,
    response_type: "code",
    redirect_uri: getOneDriveRedirectUri(),
    response_mode: "fragment",
    scope: SCOPE,
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * 認可の窓を開いて、同意 → コード交換 → 保存まで進める。
 * **ユーザージェスチャのハンドラから同期的に呼ぶこと**（最初の await より前に
 * window.open する）。prepareOneDriveAuth が済んでいなければ PushConfigError で
 * reject する — ここで準備を await すると iOS で窓がブロックされるため、
 * 遅延準備にはフォールバックしない。
 */
export function connectInteractive(): Promise<void> {
  if (pendingConnect) return pendingConnect; // 二重タップは同じ要求に相乗り
  const p = prepared;
  if (!p) {
    return Promise.reject(
      new PushConfigError("OneDrive auth is not prepared; call prepareOneDriveAuth() first"),
    );
  }
  // ↓ 同期のまま window.open（ここまでに await を置かない）
  const popup = window.open(buildAuthorizeUrl(p), "graphium-onedrive-auth", "popup,width=520,height=720");
  if (!popup) {
    // 開けなかった（ブロック）。PKCE の組は未使用なのでそのまま残す
    return Promise.reject(new PushAuthError("The sign-in window could not be opened"));
  }
  // 使い捨て: 同じ verifier / state を 2 度使わない
  prepared = null;

  const epoch = authEpoch;
  const job = waitForAuthCode(popup, p)
    .then((code) => exchangeCode(p, code, epoch))
    .finally(() => {
      pendingConnect = null;
      // 次の接続に備えて新しい組を作る（失敗しても接続時に PushConfigError で分かる）
      void prepareOneDriveAuth(p.clientId).catch(() => {});
    });
  pendingConnect = job;
  return job;
}

/** 戻りのメッセージ（BroadcastChannel / postMessage）から、state が一致するものだけ採る。 */
function waitForAuthCode(popup: Window, p: PreparedAuth): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let channel: BroadcastChannel | null = null;
    let closedTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      if (closedTimer) clearTimeout(closedTimer);
      window.removeEventListener("message", onWindowMessage);
      if (channel) {
        channel.onmessage = null;
        channel.close();
      }
      try {
        if (!popup.closed) popup.close();
      } catch {
        // 閉じられなくても致命的にしない
      }
      action();
    };

    const handle = (data: unknown) => {
      if (!data || typeof data !== "object") return;
      const msg = data as AuthMessage;
      if (msg.type !== ONEDRIVE_AUTH_CHANNEL) return;
      // state が一致しないものは別の要求・偽の戻りなので無視する
      if (typeof msg.state !== "string" || msg.state !== p.state) return;
      if (msg.error) {
        finish(() => reject(new PushAuthError(msg.error_description || msg.error || "Sign-in was declined")));
        return;
      }
      if (typeof msg.code === "string" && msg.code !== "") {
        const code = msg.code;
        finish(() => resolve(code));
      }
    };

    const onWindowMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      handle(event.data);
    };

    try {
      channel = new BroadcastChannel(ONEDRIVE_AUTH_CHANNEL);
      channel.onmessage = (event: MessageEvent) => handle(event.data);
    } catch {
      // BroadcastChannel が無い環境は postMessage だけで受ける
    }
    window.addEventListener("message", onWindowMessage);

    const pollTimer = setInterval(() => {
      let closed = false;
      try {
        closed = popup.closed;
      } catch {
        closed = false;
      }
      if (closed && !closedTimer) {
        // 戻りのメッセージが少し遅れて届くことがあるので、猶予を置いてから諦める
        closedTimer = setTimeout(() => {
          finish(() => reject(new PushAuthError("The sign-in window was closed")));
        }, CLOSED_GRACE_MS);
      }
    }, CLOSED_POLL_MS);

    const timeoutTimer = setTimeout(() => {
      finish(() => reject(new PushAuthError("Sign-in timed out")));
    }, CONNECT_TIMEOUT_MS);
  });
}

// ── /token ──

async function postToken(body: Record<string, string>): Promise<Response> {
  return fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

async function readTokenResponse(res: Response): Promise<TokenResponse> {
  try {
    return (await res.json()) as TokenResponse;
  } catch {
    return {};
  }
}

function expiresAtFrom(json: TokenResponse): number {
  const sec = Number(json.expires_in ?? 0);
  return Date.now() + (Number.isFinite(sec) ? sec : 0) * 1000;
}

/** 認可コードを /token で鍵に換えて保存する。 */
async function exchangeCode(p: PreparedAuth, code: string, epoch: number): Promise<void> {
  const res = await postToken({
    grant_type: "authorization_code",
    client_id: p.clientId,
    code,
    redirect_uri: getOneDriveRedirectUri(),
    code_verifier: p.codeVerifier,
  });
  const json = await readTokenResponse(res);
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new PushAuthError(json.error_description || json.error || `Token exchange failed (${res.status})`);
  }
  if (epoch !== authEpoch) {
    // 窓を開いたあとで切断された。切断を優先し、鍵は保存しない
    throw new PushAuthError("Disconnected while signing in");
  }
  markLinked();
  saveStoredToken({
    accessToken: json.access_token,
    expiresAt: expiresAtFrom(json),
    refreshToken: json.refresh_token,
    refreshExpiresAt: Date.now() + REFRESH_LIFETIME_MS,
  });
}

/** 更新用の鍵でアクセス用を取り直す。400 系は鍵を破棄して null、通信失敗は throw（鍵は残す）。 */
async function refreshAccessToken(stored: StoredToken): Promise<string | null> {
  const clientId = getOneDriveClientId();
  if (!clientId) return null;
  const res = await postToken({
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: stored.refreshToken,
    scope: SCOPE,
  });
  const json = await readTokenResponse(res);
  if (res.status === 400 || res.status === 401) {
    // invalid_grant など。鍵はもう使えないので破棄する。ただし待っている間に
    // つなぎ直して新しい鍵に替わっていたら、そちらは消さない
    const latest = loadStoredToken();
    if (latest && latest.refreshToken === stored.refreshToken) saveStoredToken(null);
    return null;
  }
  if (!res.ok || !json.access_token) {
    // 5xx など一時的な不調。鍵は残してキューの再試行に任せる
    throw new Error(`OneDrive token refresh failed (${res.status})`);
  }
  // 待っている間に切断・別の鍵への置き換えがあれば、その結果を上書きしない
  const current = loadStoredToken();
  if (!current || current.refreshToken !== stored.refreshToken) return null;
  saveStoredToken({
    accessToken: json.access_token,
    expiresAt: expiresAtFrom(json),
    refreshToken: json.refresh_token || stored.refreshToken,
    // 更新しても 24 時間は延びない
    refreshExpiresAt: stored.refreshExpiresAt,
  });
  return json.access_token;
}

/**
 * 有効なアクセス用の鍵。生きていればそのまま、切れていて更新用が生きていれば取り直す
 * （同時に呼ばれても /token は 1 回）。どちらも無ければ null。
 * ネットワーク失敗は鍵を消さずに throw する。
 */
export function getValidAccessToken(): Promise<string | null> {
  const stored = loadStoredToken();
  if (!stored) return Promise.resolve(null);
  if (stored.accessToken !== "" && Date.now() < stored.expiresAt - EXPIRY_MARGIN_MS) {
    return Promise.resolve(stored.accessToken);
  }
  if (stored.refreshToken === "" || Date.now() >= stored.refreshExpiresAt) {
    saveStoredToken(null);
    return Promise.resolve(null);
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken(stored).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * アクセス用だけ捨てる（更新用は残す）。Graph が 401 を返したとき
 * （手元の期限より Microsoft 側の判定が正）に呼ぶ。
 */
export function invalidateAccessToken(): void {
  const stored = loadStoredToken();
  if (!stored) return;
  saveStoredToken({ ...stored, accessToken: "", expiresAt: 0 });
}

/** 切断: 端末の鍵と印を消すだけ（Microsoft に失効 API は無い）。 */
export function disconnectOneDriveAuth(): void {
  authEpoch += 1;
  clearLinked();
  saveStoredToken(null);
}
