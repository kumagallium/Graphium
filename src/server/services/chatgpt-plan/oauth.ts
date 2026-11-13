// Sign in with ChatGPT の OAuth 部品（副作用なし）
//
// PKCE・authorize URL・callback の解釈・token 交換 / refresh / revoke・ID トークン検証を、
// 状態を持たない関数として置く。fetch と時計は引数で受け、テストで差し替えられる。
// トークン・authorize URL（id_token_hint を含みうる）はログに出さない。

import { createHash, createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";

export const AUTH_ISSUER = "https://auth.openai.com";
export const AUTHORIZE_ENDPOINT = `${AUTH_ISSUER}/api/accounts/authorize`;
export const TOKEN_ENDPOINT = `${AUTH_ISSUER}/api/accounts/oauth/token`;
export const DISCOVERY_URL = `${AUTH_ISSUER}/.well-known/openid-configuration`;
export const RESOURCE = "https://api.openai.com/v1";
/** 初回登録のときだけ使う仮のクライアント ID（保存してはいけない） */
export const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
export const AGENT_NAME_HINT = "Graphium";
export const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "resource.invoke",
  "chatgpt.tokens.use.direct",
] as const;
/** プラン利用（ChatGPT のサブスク枠で推論する）の許可を表すスコープ */
export const PLAN_USAGE_SCOPE = "chatgpt.tokens.use.direct";
/** 初回登録の redirect_uri は固定 */
export const REGISTRATION_PORT = 1455;
/** OAuth 系の HTTP 呼び出しの上限（30 秒） */
export const HTTP_TIMEOUT_MS = 30_000;
export const CALLBACK_PATH = "/auth/callback";

/** リフレッシュトークンが二度と使えないことを示すエラーコード（トークンを消して再サインイン） */
export const TERMINAL_REFRESH_ERRORS: ReadonlySet<string> = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

type FetchFn = typeof fetch;

/** OAuth 部品の失敗。oauthCode は token エンドポイントの error、status は HTTP ステータス */
export class OAuthError extends Error {
  readonly oauthCode: string | null;
  readonly status: number | null;
  constructor(message: string, oauthCode: string | null = null, status: number | null = null) {
    super(message);
    this.name = "OAuthError";
    this.oauthCode = oauthCode;
    this.status = status;
  }
}

// ---- PKCE・乱数 ----

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomUrlToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomUrlToken(48);
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

// ---- authorize URL ----

export type AuthorizeParams = {
  /** 初回登録は DYNAMIC_CLIENT_ID、再認可は発行済みの ID */
  clientId: string;
  /** 初回登録のときだけ agent_name_hint を付ける */
  registering: boolean;
  hostId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  idTokenHint?: string;
  loginHint?: string;
};

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const q = new URLSearchParams();
  q.set("client_id", p.clientId);
  if (p.registering) q.set("agent_name_hint", AGENT_NAME_HINT);
  q.set("ext_agent_host_id", p.hostId);
  if (p.idTokenHint) q.set("id_token_hint", p.idTokenHint);
  if (p.loginHint) q.set("login_hint", p.loginHint);
  q.set("response_type", "code");
  q.set("redirect_uri", p.redirectUri);
  q.set("scope", SCOPES.join(" "));
  q.set("resource", RESOURCE);
  q.set("state", p.state);
  q.set("nonce", p.nonce);
  q.set("code_challenge_method", "S256");
  q.set("code_challenge", p.codeChallenge);
  return `${AUTHORIZE_ENDPOINT}?${q.toString()}`;
}

// ---- callback ----

export type CallbackResult =
  | { kind: "code"; code: string; clientId: string | null; scope: string | null }
  | { kind: "denied" }
  | { kind: "state-mismatch" }
  | { kind: "error"; message: string };

/**
 * callback の URL（パス + クエリ）を解釈する。
 * - state が違えば state-mismatch（呼び出し側は待ち受けを続ける）
 * - error=access_denied は state を確かめたうえで denied
 * - 初回登録では client_id が必須。再認可で付いていて保存済みと違えば拒否
 */
export function parseCallback(
  searchParams: URLSearchParams,
  opts: { expectedState: string; registering: boolean; savedClientId?: string | null },
): CallbackResult {
  if (searchParams.get("state") !== opts.expectedState) return { kind: "state-mismatch" };
  const error = searchParams.get("error");
  if (error === "access_denied") return { kind: "denied" };
  if (error) return { kind: "error", message: `Authorization failed (${error}).` };
  const code = searchParams.get("code");
  if (!code) return { kind: "error", message: "The authorization response had no code." };
  const clientId = searchParams.get("client_id");
  if (opts.registering) {
    if (!clientId || clientId === DYNAMIC_CLIENT_ID) {
      return { kind: "error", message: "The authorization response had no issued client_id." };
    }
  } else if (clientId && opts.savedClientId && clientId !== opts.savedClientId) {
    return { kind: "error", message: "The authorization response was for a different client." };
  }
  return { kind: "code", code, clientId, scope: searchParams.get("scope") };
}

// ---- token エンドポイント ----

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  /** 期限（ms epoch） */
  expiresAt: number;
  /** 「これ以降なら更新してよい」時刻（ms epoch。無ければ null） */
  earliestRefreshAt: number | null;
  /** 応答の scope（無ければ null） */
  scopes: string[] | null;
};

/** earliest_refresh_at は秒・ミリ秒・ISO 文字列のどれで来ても ms epoch にする */
function toEpochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  if (typeof v === "string" && v) {
    if (/^\d+(\.\d+)?$/.test(v)) return toEpochMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

async function postForm(
  fetchFn: FetchFn,
  url: string,
  params: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: Record<string, unknown> | null }> {
  const res = await fetchFn(url, {
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const text = await res.text().catch(() => "");
  // 切り分け用（GRAPHIUM_CHATGPT_DEBUG=1 のときだけ）。失敗応答の本文と、送った項目の名前・長さだけを出す。
  // 値（code・verifier・トークン）は出さない
  if (!res.ok && process.env.GRAPHIUM_CHATGPT_DEBUG === "1") {
    const shape = Object.entries(params)
      .map(([k, v]) => `${k}(${v.length}${/\s/.test(v) ? ",has-space" : ""})`)
      .join(" ");
    console.warn(`[chatgpt-plan] POST ${new URL(url).pathname} -> ${res.status} body=${text.slice(0, 600)} sent=${shape}`);
  }
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

/** 失敗応答の説明文（error_description など）。原因の切り分け用。失敗応答にトークンは含まれない */
function errorDetailOf(body: Record<string, unknown> | null): string {
  if (!body) return "";
  const e = body.error;
  const d =
    (typeof body.error_description === "string" && body.error_description) ||
    (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
      ? (e as { message: string }).message
      : "") ||
    (typeof body.detail === "string" ? body.detail : "");
  return d ? ` ${d.slice(0, 300)}` : "";
}

function errorCodeOf(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  const e = body.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string") {
    return (e as { code: string }).code;
  }
  return null;
}

function parseTokenResponse(body: Record<string, unknown> | null, now: number): TokenSet {
  const access = body?.access_token;
  if (typeof access !== "string" || !access) {
    throw new OAuthError("The token response had no access_token.");
  }
  const expiresIn = typeof body?.expires_in === "number" ? body.expires_in : 3600;
  const scope = typeof body?.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : null;
  return {
    accessToken: access,
    refreshToken: typeof body?.refresh_token === "string" ? body.refresh_token : null,
    idToken: typeof body?.id_token === "string" ? body.id_token : null,
    expiresAt: now + expiresIn * 1000,
    earliestRefreshAt: toEpochMs(body?.earliest_refresh_at),
    scopes: scope,
  };
}

export async function exchangeCode(
  fetchFn: FetchFn,
  p: { clientId: string; code: string; codeVerifier: string; redirectUri: string },
  now = Date.now(),
): Promise<TokenSet> {
  const r = await postForm(fetchFn, TOKEN_ENDPOINT, {
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.codeVerifier,
    redirect_uri: p.redirectUri,
    resource: RESOURCE,
  });
  if (!r.ok) {
    const code = errorCodeOf(r.body);
    throw new OAuthError(`Token exchange failed (${r.status}${code ? `, ${code}` : ""}).${errorDetailOf(r.body)}`, code, r.status);
  }
  return parseTokenResponse(r.body, now);
}

/** scope は送らない（付与済みの範囲で更新される） */
export async function refreshTokens(
  fetchFn: FetchFn,
  p: { clientId: string; refreshToken: string },
  now = Date.now(),
): Promise<TokenSet> {
  const r = await postForm(fetchFn, TOKEN_ENDPOINT, {
    grant_type: "refresh_token",
    client_id: p.clientId,
    refresh_token: p.refreshToken,
    resource: RESOURCE,
  });
  if (!r.ok) {
    const code = errorCodeOf(r.body);
    throw new OAuthError(`Token refresh failed (${r.status}${code ? `, ${code}` : ""}).${errorDetailOf(r.body)}`, code, r.status);
  }
  return parseTokenResponse(r.body, now);
}

/** refresh の失敗が「リフレッシュトークンはもう使えない」終端か（ネットワーク失敗・5xx は false） */
export function isTerminalRefreshError(err: unknown): boolean {
  return err instanceof OAuthError && err.oauthCode !== null && TERMINAL_REFRESH_ERRORS.has(err.oauthCode);
}

export async function revokeToken(
  fetchFn: FetchFn,
  p: { revocationEndpoint: string; token: string; clientId: string },
): Promise<boolean> {
  const r = await postForm(fetchFn, p.revocationEndpoint, {
    token: p.token,
    token_type_hint: "refresh_token",
    client_id: p.clientId,
  });
  return r.status === 200;
}

// ---- discovery・JWKS ----

export type Discovery = { jwksUri: string; revocationEndpoint: string | null };

export async function fetchDiscovery(fetchFn: FetchFn): Promise<Discovery> {
  const res = await fetchFn(DISCOVERY_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new OAuthError(`Discovery failed (${res.status}).`, null, res.status);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const jwksUri = body?.jwks_uri;
  if (typeof jwksUri !== "string" || !jwksUri) throw new OAuthError("Discovery had no jwks_uri.");
  const rev = body?.revocation_endpoint;
  return { jwksUri, revocationEndpoint: typeof rev === "string" && rev ? rev : null };
}

export type Jwk = { kty?: string; kid?: string; alg?: string; use?: string; [k: string]: unknown };

export async function fetchJwks(fetchFn: FetchFn, jwksUri: string): Promise<Jwk[]> {
  const res = await fetchFn(jwksUri, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS), headers: { Accept: "application/json" } });
  if (!res.ok) throw new OAuthError(`JWKS fetch failed (${res.status}).`, null, res.status);
  const body = (await res.json().catch(() => null)) as { keys?: unknown } | null;
  if (!body || !Array.isArray(body.keys)) throw new OAuthError("JWKS had no keys.");
  return body.keys as Jwk[];
}

// ---- ID トークン ----

export type IdTokenClaims = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  azp?: string;
  sub?: string;
  email?: string;
  [k: string]: unknown;
};

function decodeSegment(seg: string): unknown {
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8"));
}

/** 署名を見ずに claims だけ読む（保存済みトークンからの参照用。信頼の根拠にしない） */
export function decodeIdTokenUnverified(token: string): IdTokenClaims | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return decodeSegment(parts[1]) as IdTokenClaims;
  } catch {
    return null;
  }
}

/**
 * ID トークンを検証して claims を返す。
 * alg は RS256 / ES256 のみ。kid で鍵を選び、iss・aud・exp・nonce（指定時）を確かめ、sub を必須にする。
 */
export function verifyIdToken(
  token: string,
  opts: { jwks: Jwk[]; clientId: string; nonce?: string; issuer?: string; now?: number; skewSec?: number },
): IdTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new OAuthError("The ID token is malformed.");
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = decodeSegment(parts[0]) as { alg?: string; kid?: string };
    claims = decodeSegment(parts[1]) as IdTokenClaims;
  } catch {
    throw new OAuthError("The ID token is malformed.");
  }
  const alg = header.alg;
  if (alg !== "RS256" && alg !== "ES256") throw new OAuthError("The ID token uses an unsupported algorithm.");

  const candidates = opts.jwks.filter((k) => {
    if (header.kid && k.kid !== header.kid) return false;
    if (k.alg && k.alg !== alg) return false;
    if (k.use && k.use !== "sig") return false;
    return alg === "RS256" ? k.kty === "RSA" : k.kty === "EC";
  });
  if (candidates.length === 0) throw new OAuthError("No matching signing key was found for the ID token.");

  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  let valid = false;
  for (const jwk of candidates) {
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" } as Parameters<typeof createPublicKey>[0]);
      valid =
        alg === "RS256"
          ? cryptoVerify("sha256", signingInput, key, signature)
          : cryptoVerify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, signature);
    } catch {
      valid = false;
    }
    if (valid) break;
  }
  if (!valid) throw new OAuthError("The ID token signature is invalid.");

  if (claims.iss !== (opts.issuer ?? AUTH_ISSUER)) throw new OAuthError("The ID token issuer is not OpenAI.");
  const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  if (!aud.includes(opts.clientId)) throw new OAuthError("The ID token audience does not match this app.");
  // aud が複数のときは、認可を受けた当事者（azp）が自分であることを要求する
  if (aud.length > 1 && claims.azp !== opts.clientId) {
    throw new OAuthError("The ID token was issued to a different authorized party.");
  }
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== "number" || claims.exp + (opts.skewSec ?? 60) < nowSec) {
    throw new OAuthError("The ID token has expired.");
  }
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) {
    throw new OAuthError("The ID token nonce does not match.");
  }
  if (typeof claims.sub !== "string" || !claims.sub) throw new OAuthError("The ID token has no subject.");
  return claims;
}
