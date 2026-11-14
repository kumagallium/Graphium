import { describe, it, expect, vi } from "vitest";
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  buildAuthorizeUrl,
  decodeIdTokenUnverified,
  exchangeCode,
  fetchDiscovery,
  fetchJwks,
  generatePkce,
  isTerminalRefreshError,
  OAuthError,
  parseCallback,
  refreshTokens,
  revokeToken,
  verifyIdToken,
  type Jwk,
} from "./oauth.js";

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");

function makeJwt(
  alg: "RS256" | "ES256",
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  kid = "k1",
): string {
  const head = b64u(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const input = Buffer.from(`${head}.${body}`);
  const sig =
    alg === "RS256"
      ? cryptoSign("sha256", input, privateKey)
      : cryptoSign("sha256", input, { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64u(sig)}`;
}

function rsa() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" } as Jwk };
}
function ec() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" } as Jwk };
}

const NOW = 1_800_000_000_000;
const baseClaims = {
  iss: "https://auth.openai.com",
  aud: "oaiapp_x",
  exp: NOW / 1000 + 600,
  nonce: "n1",
  sub: "user-1",
  email: "a@example.com",
};

describe("PKCE / authorize URL", () => {
  it("challenge は verifier の SHA-256 の base64url（パディング無し）", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(challenge).not.toMatch(/[=+/]/);
  });

  it("初回登録: agent_name_hint あり・id_token_hint なし", () => {
    const u = new URL(
      buildAuthorizeUrl({
        clientId: "dynamic_agent_client",
        registering: true,
        hostId: "urn:uuid:1",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
      }),
    );
    expect(u.origin + u.pathname).toBe("https://auth.openai.com/api/accounts/authorize");
    expect(u.searchParams.get("agent_name_hint")).toBe("Graphium");
    expect(u.searchParams.get("id_token_hint")).toBeNull();
    expect(u.searchParams.get("ext_agent_host_id")).toBe("urn:uuid:1");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("resource")).toBe("https://api.openai.com/v1");
    expect(u.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
  });

  it("再認可: agent_name_hint なし・id_token_hint と login_hint あり", () => {
    const u = new URL(
      buildAuthorizeUrl({
        clientId: "oaiapp_x",
        registering: false,
        hostId: "urn:uuid:1",
        redirectUri: "http://127.0.0.1:5555/auth/callback",
        state: "s",
        nonce: "n",
        codeChallenge: "c",
        idTokenHint: "hint.jwt.x",
        loginHint: "a@example.com",
      }),
    );
    expect(u.searchParams.get("agent_name_hint")).toBeNull();
    expect(u.searchParams.get("id_token_hint")).toBe("hint.jwt.x");
    expect(u.searchParams.get("login_hint")).toBe("a@example.com");
  });
});

describe("parseCallback", () => {
  const q = (s: string) => new URLSearchParams(s);
  it("初回登録は client_id 必須・dynamic_agent_client は拒否", () => {
    const o = { expectedState: "s", registering: true };
    expect(parseCallback(q("code=c&state=s&client_id=oaiapp_1"), o)).toMatchObject({ kind: "code", clientId: "oaiapp_1" });
    expect(parseCallback(q("code=c&state=s"), o).kind).toBe("error");
    expect(parseCallback(q("code=c&state=s&client_id=dynamic_agent_client"), o).kind).toBe("error");
  });
  it("state が違えば state-mismatch", () => {
    expect(parseCallback(q("code=c&state=zzz"), { expectedState: "s", registering: false }).kind).toBe("state-mismatch");
  });
  it("access_denied は state 確認後に denied", () => {
    expect(parseCallback(q("error=access_denied&state=s"), { expectedState: "s", registering: true }).kind).toBe("denied");
    expect(parseCallback(q("error=access_denied&state=bad"), { expectedState: "s", registering: true }).kind).toBe("state-mismatch");
  });
  it("再認可で client_id が保存済みと違えば拒否、同じ・無しなら通す", () => {
    const o = { expectedState: "s", registering: false, savedClientId: "oaiapp_1" };
    expect(parseCallback(q("code=c&state=s&client_id=oaiapp_2"), o).kind).toBe("error");
    expect(parseCallback(q("code=c&state=s&client_id=oaiapp_1"), o).kind).toBe("code");
    expect(parseCallback(q("code=c&state=s"), o).kind).toBe("code");
  });
});

describe("token エンドポイント", () => {
  const jsonRes = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("exchangeCode: form 本文と応答の正規化", async () => {
    let seen: { url: string; body: URLSearchParams } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: new URLSearchParams(String(init.body)) };
      return jsonRes(200, {
        access_token: "a",
        refresh_token: "r",
        id_token: "i",
        expires_in: 3600,
        scope: "openid chatgpt.tokens.use.direct",
        earliest_refresh_at: "2027-01-15T08:00:00Z",
      });
    }) as unknown as typeof fetch;
    const t = await exchangeCode(f, { clientId: "oaiapp_1", code: "c", codeVerifier: "v", redirectUri: "http://127.0.0.1:1455/auth/callback" }, NOW);
    expect(seen!.url).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(seen!.body.get("grant_type")).toBe("authorization_code");
    expect(seen!.body.get("code_verifier")).toBe("v");
    expect(seen!.body.get("resource")).toBe("https://api.openai.com/v1");
    expect(t.expiresAt).toBe(NOW + 3600_000);
    expect(t.scopes).toEqual(["openid", "chatgpt.tokens.use.direct"]);
    expect(t.earliestRefreshAt).toBe(Date.parse("2027-01-15T08:00:00Z"));
  });

  it("refreshTokens は scope を送らず、終端エラーを見分ける", async () => {
    let body: URLSearchParams | null = null;
    const bad = (async (_u: string, init: RequestInit) => {
      body = new URLSearchParams(String(init.body));
      return jsonRes(400, { error: "refresh_token_reused" });
    }) as unknown as typeof fetch;
    const err = await refreshTokens(bad, { clientId: "c", refreshToken: "r" }).catch((e) => e);
    expect(body!.get("grant_type")).toBe("refresh_token");
    expect(body!.has("scope")).toBe(false);
    expect(isTerminalRefreshError(err)).toBe(true);

    const e5 = await refreshTokens((async () => jsonRes(503, { detail: "x" })) as unknown as typeof fetch, {
      clientId: "c",
      refreshToken: "r",
    }).catch((e) => e);
    expect(e5).toBeInstanceOf(OAuthError);
    expect(isTerminalRefreshError(e5)).toBe(false);
    expect(isTerminalRefreshError(new TypeError("fetch failed"))).toBe(false);
  });

  it("token / discovery / JWKS / revoke の fetch には中断シグナル（タイムアウト）が付く", async () => {
    const signals: unknown[] = [];
    const f = (async (_u: string, init: RequestInit) => {
      signals.push(init.signal);
      return new Response(JSON.stringify({ jwks_uri: "https://j", keys: [], access_token: "a" }), { status: 200 });
    }) as unknown as typeof fetch;
    await fetchDiscovery(f);
    await fetchJwks(f, "https://j");
    await exchangeCode(f, { clientId: "c", code: "c", codeVerifier: "v", redirectUri: "r" });
    await revokeToken(f, { revocationEndpoint: "https://r", token: "t", clientId: "c" });
    expect(signals).toHaveLength(4);
    expect(signals.every((x) => x instanceof AbortSignal)).toBe(true);
  });

  it("失敗応答の error_description / error.message / detail をメッセージに含める", async () => {
    const mk = (body: unknown) => (async () => jsonRes(400, body)) as unknown as typeof fetch;
    const args = { clientId: "c", code: "c", codeVerifier: "v", redirectUri: "r" };
    const e1 = await exchangeCode(mk({ error: "invalid_grant", error_description: "code was already used" }), args).catch((e) => e);
    expect(e1.message).toContain("invalid_grant");
    expect(e1.message).toContain("code was already used");
    expect(e1.oauthCode).toBe("invalid_grant");
    const e2 = await exchangeCode(mk({ error: { code: "x", message: "nested message" } }), args).catch((e) => e);
    expect(e2.message).toContain("nested message");
    const e3 = await refreshTokens(mk({ detail: "plain detail" }), { clientId: "c", refreshToken: "r" }).catch((e) => e);
    expect(e3.message).toContain("plain detail");
  });

  it("GRAPHIUM_CHATGPT_DEBUG=1 のときだけ warn を出し、値は出さず長さだけを出す", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = (async () => jsonRes(400, { error: "invalid_grant" })) as unknown as typeof fetch;
    const args = { clientId: "oaiapp_1", code: "SECRETCODE123", codeVerifier: "SECRETVERIFIER456", redirectUri: "http://127.0.0.1:1455/auth/callback" };
    const prev = process.env.GRAPHIUM_CHATGPT_DEBUG;
    try {
      delete process.env.GRAPHIUM_CHATGPT_DEBUG;
      await exchangeCode(f, args).catch(() => undefined);
      expect(warn).not.toHaveBeenCalled();
      process.env.GRAPHIUM_CHATGPT_DEBUG = "1";
      await exchangeCode(f, args).catch(() => undefined);
      expect(warn).toHaveBeenCalledTimes(1);
      const out = String(warn.mock.calls[0].join(" "));
      expect(out).toContain("code(13)");
      expect(out).toContain("code_verifier(17)");
      expect(out).not.toContain("SECRETCODE123");
      expect(out).not.toContain("SECRETVERIFIER456");
      expect(out).toContain("invalid_grant");
    } finally {
      if (prev === undefined) delete process.env.GRAPHIUM_CHATGPT_DEBUG;
      else process.env.GRAPHIUM_CHATGPT_DEBUG = prev;
      warn.mockRestore();
    }
  });

  it("revokeToken は 200 だけ成功", async () => {
    let body: URLSearchParams | null = null;
    const f = (async (_u: string, init: RequestInit) => {
      body = new URLSearchParams(String(init.body));
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await revokeToken(f, { revocationEndpoint: "https://x/revoke", token: "r", clientId: "c" })).toBe(true);
    expect(body!.get("token_type_hint")).toBe("refresh_token");
    const f500 = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    expect(await revokeToken(f500, { revocationEndpoint: "https://x/revoke", token: "r", clientId: "c" })).toBe(false);
  });

  it("fetchDiscovery は jwks_uri と revocation_endpoint を読む", async () => {
    const f = (async () => jsonRes(200, { jwks_uri: "https://j", revocation_endpoint: "https://r" })) as unknown as typeof fetch;
    expect(await fetchDiscovery(f)).toEqual({ jwksUri: "https://j", revocationEndpoint: "https://r" });
  });
});

describe("verifyIdToken", () => {
  it("RS256 を検証して claims を返す", () => {
    const { privateKey, jwk } = rsa();
    const jwt = makeJwt("RS256", privateKey, baseClaims);
    const c = verifyIdToken(jwt, { jwks: [jwk], clientId: "oaiapp_x", nonce: "n1", now: NOW });
    expect(c.sub).toBe("user-1");
    expect(decodeIdTokenUnverified(jwt)?.email).toBe("a@example.com");
  });

  it("ES256（ieee-p1363）を検証する・aud が配列でも可", () => {
    const { privateKey, jwk } = ec();
    const jwt = makeJwt("ES256", privateKey, { ...baseClaims, aud: ["other", "oaiapp_x"], azp: "oaiapp_x" });
    expect(verifyIdToken(jwt, { jwks: [jwk], clientId: "oaiapp_x", nonce: "n1", now: NOW }).sub).toBe("user-1");
  });

  it("aud が複数で azp が自分でなければ拒否する", () => {
    const { privateKey, jwk } = rsa();
    const opts = { jwks: [jwk], clientId: "oaiapp_x", nonce: "n1", now: NOW };
    const multi = { ...baseClaims, aud: ["other", "oaiapp_x"] };
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, multi), opts)).toThrow(/authorized party/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, { ...multi, azp: "other" }), opts)).toThrow(/authorized party/);
  });

  it("署名・iss・aud・exp・nonce・kid の不一致を拒否する", () => {
    const { privateKey, jwk } = rsa();
    const other = rsa();
    const opts = { jwks: [jwk], clientId: "oaiapp_x", nonce: "n1", now: NOW };
    expect(() => verifyIdToken(makeJwt("RS256", other.privateKey, baseClaims), opts)).toThrow(/signature/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, { ...baseClaims, iss: "https://evil" }), opts)).toThrow(/issuer/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, { ...baseClaims, aud: "other" }), opts)).toThrow(/audience/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, { ...baseClaims, exp: NOW / 1000 - 3600 }), opts)).toThrow(/expired/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, { ...baseClaims, nonce: "zz" }), opts)).toThrow(/nonce/);
    expect(() => verifyIdToken(makeJwt("RS256", privateKey, baseClaims, "unknown-kid"), opts)).toThrow(/key/);
  });

  it("alg=none や HS256 は拒否する", () => {
    const head = b64u(JSON.stringify({ alg: "none" }));
    const jwt = `${head}.${b64u(JSON.stringify(baseClaims))}.`;
    expect(() => verifyIdToken(jwt, { jwks: [], clientId: "oaiapp_x", now: NOW })).toThrow(/unsupported/);
  });
});
