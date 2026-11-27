// Graphium token broker。OAuth の code / refresh token を Google の token endpoint と
// 引き換えるだけの、状態を持たない Worker。client secret はここにだけ置く。
// 何も保存せず、何もログに出さない（console.* を書かない）。

export interface Env {
  ALLOWED_ORIGINS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  // Cloudflare の Rate Limiting バインディング（任意）。無ければ制限しない。
  RATE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

// 宛先は定数。リクエストからは一切受け取らない。
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const REQUIRED_SCOPE = "https://www.googleapis.com/auth/drive.file";
const MAX_BODY_BYTES = 4096;
const MAX_FIELD_LENGTH = 2048;

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>;

function baseHeaders(origin: string | null): Headers {
  const h = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin) {
    h.set("Access-Control-Allow-Origin", origin);
  }
  return h;
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(origin),
  });
}

function isAllowedOrigin(origin: string | null, env: Env): origin is string {
  if (!origin) return false;
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

// 累積バイト数を数え、上限を超えた時点で読み取りを打ち切る（Content-Length に依存しない）。
async function readLimitedBody(request: Request): Promise<string | null> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function validField(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_FIELD_LENGTH;
}

async function postForm(
  fetchImpl: FetchImpl,
  url: string,
  params: Record<string, string>,
): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
}

// 失効はベストエフォート。失敗しても無視する。
async function revokeQuietly(fetchImpl: FetchImpl, token: string): Promise<void> {
  try {
    await postForm(fetchImpl, REVOKE_ENDPOINT, { token });
  } catch {
    // 無視
  }
}

export async function handleRequest(
  request: Request,
  env: Env,
  fetchImpl: FetchImpl = (u, i) => fetch(u, i),
): Promise<Response> {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const path = url.pathname;

  if (!isAllowedOrigin(origin, env)) {
    return json({ error: "origin_not_allowed" }, 403, null);
  }

  if (request.method === "OPTIONS") {
    const h = baseHeaders(origin);
    h.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "content-type, x-requested-with");
    h.set("Access-Control-Max-Age", "600");
    return new Response(null, { status: 204, headers: h });
  }

  if (path !== "/exchange" && path !== "/refresh") {
    return json({ error: "not_found" }, 404, origin);
  }
  if (request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405, origin);
  }

  if (request.headers.get("x-requested-with") !== "graphium") {
    return json({ error: "missing_header" }, 403, origin);
  }
  const ct = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (ct !== "application/json") {
    return json({ error: "unsupported_media_type" }, 415, origin);
  }

  // レート制限（バインディングがあるときだけ）。故障時は通す。
  if (env.RATE_LIMITER) {
    try {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key });
      if (!success) return json({ error: "rate_limited" }, 429, origin);
    } catch {
      // 制限側の故障で正規の利用を止めない
    }
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return json({ error: "not_configured" }, 500, origin);
  }

  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "payload_too_large" }, 413, origin);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "invalid_json" }, 400, origin);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return json({ error: "invalid_request" }, 400, origin);
  }
  const body = parsed as Record<string, unknown>;
  const isExchange = path === "/exchange";
  const input = isExchange ? body.code : body.refresh_token;
  if (!validField(input)) {
    return json({ error: "invalid_request" }, 400, origin);
  }

  const params: Record<string, string> = isExchange
    ? {
        grant_type: "authorization_code",
        code: input,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: "postmessage",
      }
    : {
        grant_type: "refresh_token",
        refresh_token: input,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
      };

  let res: Response;
  try {
    res = await postForm(fetchImpl, TOKEN_ENDPOINT, params);
  } catch {
    return json({ error: "upstream_unavailable" }, 502, origin);
  }

  if (res.status >= 500) {
    return json({ error: "upstream_unavailable" }, 502, origin);
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "upstream_unavailable" }, 502, origin);
  }

  if (!res.ok) {
    if ((res.status === 400 || res.status === 401) && typeof data?.error === "string") {
      return json({ error: data.error }, 400, origin);
    }
    return json({ error: "upstream_unavailable" }, 502, origin);
  }

  if (typeof data.access_token !== "string") {
    return json({ error: "upstream_unavailable" }, 502, origin);
  }

  // scope の締め: drive.file ちょうど 1 つだけ許す。
  const hasScope = typeof data.scope === "string";
  if (hasScope) {
    const scopes = (data.scope as string).split(/\s+/).filter(Boolean);
    if (scopes.length !== 1 || scopes[0] !== REQUIRED_SCOPE) {
      // /exchange は受け取った refresh_token（無ければ access_token）、
      // /refresh はリクエストで受けた refresh_token を捨てる。
      const target = isExchange
        ? typeof data.refresh_token === "string"
          ? data.refresh_token
          : data.access_token
        : input;
      await revokeQuietly(fetchImpl, target);
      return json({ error: "scope_not_allowed" }, 403, origin);
    }
  } else if (isExchange) {
    // /exchange で scope が無い応答は確認できないので通さない。
    await revokeQuietly(
      fetchImpl,
      typeof data.refresh_token === "string" ? data.refresh_token : data.access_token,
    );
    return json({ error: "scope_not_allowed" }, 403, origin);
  }

  const out: Record<string, unknown> = {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
  if (isExchange && typeof data.refresh_token === "string") {
    out.refresh_token = data.refresh_token;
  }
  return json(out, 200, origin);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
