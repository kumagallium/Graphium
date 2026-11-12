import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDataDir, getServerMode, setDataDir, setServerMode } from "../../config/models.js";
import { CodedError } from "../../../lib/ai-error-codes.js";
import { createChatGptPlanManager } from "./manager.js";
import { loadAuth, updateAuth } from "./store.js";

const b64u = (v: string | Buffer) => Buffer.from(v).toString("base64url");
const CLIENT_ID = "oaiapp_test";
const SCOPE_FULL = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

function idToken(claims: Record<string, unknown>, key: KeyObject = privateKey): string {
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const body = b64u(
    JSON.stringify({
      iss: "https://auth.openai.com",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      sub: "user-1",
      email: "me@example.com",
      ...claims,
    }),
  );
  const sig = cryptoSign("sha256", Buffer.from(`${head}.${body}`), key);
  return `${head}.${body}.${b64u(sig)}`;
}

type Call = { url: string; body: URLSearchParams | null };

/** OpenAI の認可サーバーを模した fetch。応答は都度差し替えられる */
function makeFetch(opts: { scope?: string; nonceFromAuthUrl?: () => string } = {}) {
  const calls: Call[] = [];
  const state = {
    scope: opts.scope ?? SCOPE_FULL,
    tokenResponse: null as null | (() => Response),
    revokeStatus: 200,
    refreshCount: 0,
    nonce: "",
  };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const f = (async (input: string, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? new URLSearchParams(String(init.body)) : null;
    calls.push({ url, body });
    if (url.endsWith("/.well-known/openid-configuration")) {
      return json(200, {
        jwks_uri: "https://auth.openai.com/jwks",
        revocation_endpoint: "https://auth.openai.com/api/accounts/oauth/revoke",
      });
    }
    if (url === "https://auth.openai.com/jwks") return json(200, { keys: [jwk] });
    if (url.endsWith("/oauth/revoke")) return new Response("", { status: state.revokeStatus });
    if (url.endsWith("/oauth/token")) {
      if (state.tokenResponse) return state.tokenResponse();
      if (body?.get("grant_type") === "refresh_token") {
        state.refreshCount++;
        return json(200, {
          access_token: `at-${state.refreshCount}`,
          refresh_token: `rt-${state.refreshCount}`,
          expires_in: 3600,
          scope: state.scope,
        });
      }
      return json(200, {
        access_token: "at-0",
        refresh_token: "rt-0",
        id_token: idToken({ nonce: state.nonce }),
        expires_in: 3600,
        scope: state.scope,
      });
    }
    return new Response("not mocked", { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls, state };
}

describe("chatgptPlanManager", () => {
  let dir: string;
  let prevDir: string;
  let prevMode: ReturnType<typeof getServerMode>;
  const blockers: Server[] = [];

  beforeEach(() => {
    prevDir = getDataDir();
    prevMode = getServerMode();
    dir = mkdtempSync(join(tmpdir(), "chatgpt-mgr-"));
    setDataDir(dir);
    setServerMode("node");
  });
  afterEach(async () => {
    setDataDir(prevDir);
    setServerMode(prevMode);
    rmSync(dir, { recursive: true, force: true });
    for (const s of blockers.splice(0)) await new Promise((r) => s.close(() => r(null)));
  });

  const mk = (fetchImpl: typeof fetch, extra = {}) =>
    createChatGptPlanManager({ fetch: fetchImpl, registrationPort: 0, ...extra });

  /** authUrl から callback を叩く（実際の HTTP） */
  async function callback(authUrl: string, extra: Record<string, string>, path = "/auth/callback") {
    const u = new URL(authUrl);
    const redirect = new URL(u.searchParams.get("redirect_uri") as string);
    const q = new URLSearchParams({ state: u.searchParams.get("state") as string, ...extra });
    return fetch(`http://127.0.0.1:${redirect.port}${path}?${q}`);
  }
  const waitSettled = async (m: ReturnType<typeof createChatGptPlanManager>) => {
    for (let i = 0; i < 100 && m.getStatus().signIn.state === "waiting"; i++) await new Promise((r) => setTimeout(r, 10));
  };

  it("初回登録: callback → 保存 → succeeded。待ち受けは閉じ、HTML に CSP が付く", async () => {
    const { f, calls, state } = makeFetch();
    const m = mk(f);
    const { authUrl } = await m.startSignIn();
    const u = new URL(authUrl);
    expect(u.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(u.searchParams.get("agent_name_hint")).toBe("Graphium");
    expect(u.searchParams.get("ext_agent_host_id")).toBe(loadAuth().hostId);
    state.nonce = u.searchParams.get("nonce") as string;
    expect(m.getStatus().signIn.state).toBe("waiting");

    const notFound = await callback(authUrl, {}, "/other");
    expect(notFound.status).toBe(404);
    // state が違う要求は無視して待ち続ける
    const bad = await fetch(`${u.searchParams.get("redirect_uri")}?code=x&state=wrong&client_id=${CLIENT_ID}`);
    expect(bad.status).toBe(400);
    expect(m.getStatus().signIn.state).toBe("waiting");

    const res = await callback(authUrl, { code: "abc", client_id: CLIENT_ID, scope: SCOPE_FULL });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    const html = await res.text();
    expect(html).toContain("return to Graphium");
    expect(html).toContain("Graphium に戻ってください");
    await waitSettled(m);

    const st = m.getStatus();
    expect(st.signIn.state).toBe("succeeded");
    expect(st.account).toEqual({ email: "me@example.com", planUsage: true, welcomed: false });
    const saved = loadAuth().account;
    expect(saved?.clientId).toBe(CLIENT_ID);
    expect(saved?.subject).toBe("user-1");
    expect(saved?.accessToken).toBe("at-0");
    const tokenCall = calls.find((c) => c.url.endsWith("/oauth/token"));
    expect(tokenCall?.body?.get("client_id")).toBe(CLIENT_ID);
    expect(tokenCall?.body?.get("code_verifier")).toBeTruthy();
    // 待ち受けは閉じている
    await expect(fetch(u.searchParams.get("redirect_uri") as string)).rejects.toThrow();
    m.resetForTest();
  });

  it("access_denied は CHATGPT_ACCESS_DENIED で failed", async () => {
    const m = mk(makeFetch().f);
    const { authUrl } = await m.startSignIn();
    await callback(authUrl, { error: "access_denied" });
    await waitSettled(m);
    expect(m.getStatus().signIn).toMatchObject({ state: "failed", errorCode: "CHATGPT_ACCESS_DENIED" });
    expect(m.getStatus().account).toBeNull();
  });

  it("nonce が違う ID トークンは保存せず failed", async () => {
    const { f, state } = makeFetch();
    state.nonce = "someone-elses";
    const m = mk(f);
    const { authUrl } = await m.startSignIn();
    await callback(authUrl, { code: "abc", client_id: CLIENT_ID });
    await waitSettled(m);
    expect(m.getStatus().signIn.state).toBe("failed");
    expect(loadAuth().account).toBeNull();
  });

  it("進行中は ALREADY_SIGNING_IN、cancel で idle に戻り再開できる", async () => {
    const m = mk(makeFetch().f);
    await m.startSignIn();
    await expect(m.startSignIn()).rejects.toMatchObject({ code: "ALREADY_SIGNING_IN" });
    m.cancelSignIn();
    expect(m.getStatus().signIn.state).toBe("idle");
    await m.startSignIn();
    m.cancelSignIn();
  });

  it("時間切れで failed になり待ち受けを閉じる", async () => {
    const m = mk(makeFetch().f, { signInTimeoutMs: 30 });
    const { authUrl } = await m.startSignIn();
    await waitSettled(m);
    expect(m.getStatus().signIn.state).toBe("failed");
    await expect(fetch(new URL(authUrl).searchParams.get("redirect_uri") as string)).rejects.toThrow();
  });

  it("初回登録のポートが使用中なら CHATGPT_PORT_IN_USE", async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const port = await new Promise<number>((r) =>
      blocker.listen(0, "127.0.0.1", () => r((blocker.address() as { port: number }).port)),
    );
    const m = mk(makeFetch().f, { registrationPort: port });
    await expect(m.startSignIn()).rejects.toMatchObject({ code: "CHATGPT_PORT_IN_USE" });
    expect(m.getStatus().signIn.state).toBe("idle");
  });

  it("Web 実行では CHATGPT_UNAVAILABLE", async () => {
    setServerMode("vercel");
    const m = mk(makeFetch().f);
    expect(m.getStatus().available).toBe(false);
    await expect(m.startSignIn()).rejects.toMatchObject({ code: "CHATGPT_UNAVAILABLE" });
  });

  it("スコープに chatgpt.tokens.use.direct が無ければ planUsage:false で getAccessToken は AUTH_EXPIRED", async () => {
    const { f, state } = makeFetch({ scope: "openid profile email offline_access" });
    const m = mk(f);
    const { authUrl } = await m.startSignIn();
    state.nonce = new URL(authUrl).searchParams.get("nonce") as string;
    await callback(authUrl, { code: "abc", client_id: CLIENT_ID });
    await waitSettled(m);
    expect(m.getStatus().signIn.state).toBe("succeeded");
    expect(m.getStatus().account?.planUsage).toBe(false);
    await expect(m.getAccessToken()).rejects.toMatchObject({ code: "CHATGPT_PLAN_AUTH_EXPIRED" });
  });

  describe("トークンの更新", () => {
    const seed = (over: Record<string, unknown> = {}) =>
      updateAuth((c) => ({
        ...c,
        account: {
          email: "me@example.com",
          subject: "user-1",
          clientId: CLIENT_ID,
          idToken: "old-id",
          accessToken: "at-old",
          refreshToken: "rt-old",
          expiresAt: Date.now() + 3600_000,
          scopes: SCOPE_FULL.split(" "),
          savedAt: 1,
          ...over,
        },
      }));

    it("サインイン無しは AUTH_EXPIRED", async () => {
      const m = mk(makeFetch().f);
      await expect(m.getAccessToken()).rejects.toBeInstanceOf(CodedError);
      await expect(m.getAccessToken()).rejects.toMatchObject({ code: "CHATGPT_PLAN_AUTH_EXPIRED" });
    });

    it("期限まで余裕があれば更新せずそのまま返す", async () => {
      const { f, calls } = makeFetch();
      seed();
      expect(await mk(f).getAccessToken()).toBe("at-old");
      expect(calls).toHaveLength(0);
    });

    it("期限の 5 分前を過ぎたら更新し、同時の呼び出しは 1 回に直列化・全部差し替える", async () => {
      const { f, state } = makeFetch();
      seed({ expiresAt: Date.now() + 60_000 });
      const m = mk(f);
      const [a, b] = await Promise.all([m.getAccessToken(), m.getAccessToken()]);
      expect(state.refreshCount).toBe(1);
      expect(a).toBe("at-1");
      expect(b).toBe("at-1");
      const acc = loadAuth().account;
      expect(acc?.refreshToken).toBe("rt-1");
      expect((acc?.expiresAt ?? 0) > Date.now() + 3000_000).toBe(true);
    });

    it("終端エラーならトークンを消して AUTH_EXPIRED（識別子と ID トークンは残る）", async () => {
      const { f, state } = makeFetch();
      state.tokenResponse = () => new Response(JSON.stringify({ error: "refresh_token_reused" }), { status: 400 });
      seed({ expiresAt: Date.now() - 1000 });
      const m = mk(f);
      await expect(m.getAccessToken()).rejects.toMatchObject({ code: "CHATGPT_PLAN_AUTH_EXPIRED" });
      const acc = loadAuth().account;
      expect(acc?.accessToken).toBeUndefined();
      expect(acc?.refreshToken).toBeUndefined();
      expect(acc).toMatchObject({ clientId: CLIENT_ID, subject: "user-1", idToken: "old-id" });
      expect(m.getStatus().account).toBeNull();
    });

    it("5xx ではトークンを消さず、期限切れ済みなら CHATGPT_PLAN_UNAVAILABLE を投げる", async () => {
      const { f, state } = makeFetch();
      state.tokenResponse = () => new Response(JSON.stringify({ detail: "down" }), { status: 503 });
      seed({ expiresAt: Date.now() - 1000 });
      const m = mk(f);
      const err = await m.getAccessToken().catch((e) => e);
      expect(err).toBeInstanceOf(CodedError);
      expect(err.code).toBe("CHATGPT_PLAN_UNAVAILABLE");
      expect(loadAuth().account?.refreshToken).toBe("rt-old");
    });

    it("他のプロセスが回転済み（保存の refreshToken が違う）なら、終端エラーでも消さない", async () => {
      const { f } = makeFetch();
      seed({ expiresAt: Date.now() - 1000 });
      const rotating = (async () => {
        updateAuth((c) => ({ ...c, account: { ...(c.account as object), refreshToken: "rt-other", accessToken: "at-other", expiresAt: Date.now() + 3600_000 } as never }));
        return new Response(JSON.stringify({ error: "refresh_token_reused" }), { status: 400 });
      }) as unknown as typeof fetch;
      expect(await mk(rotating).getAccessToken()).toBe("at-other");
      expect(loadAuth().account?.refreshToken).toBe("rt-other");
      void f;
    });

    it("更新中にサインアウトしても、更新の結果で復活しない", async () => {
      const { f } = makeFetch();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = (async (u: string, i: RequestInit) => {
        if (String(i.body).includes("grant_type=refresh_token")) await gate;
        return f(u, i);
      }) as unknown as typeof fetch;
      seed({ expiresAt: Date.now() - 1000 });
      const m = mk(slow);
      const pending = m.getAccessToken().catch((e) => e);
      await new Promise((r) => setTimeout(r, 20));
      const out = m.signOut();
      release();
      await pending;
      await out;
      expect(m.getStatus().account).toBeNull();
      expect(loadAuth().account?.accessToken).toBeUndefined();
      expect(loadAuth().account?.refreshToken).toBeUndefined();
    });

    it("5xx でもアクセストークンがまだ有効ならそれを返す", async () => {
      const { f, state } = makeFetch();
      state.tokenResponse = () => new Response("", { status: 503 });
      seed({ expiresAt: Date.now() + 2 * 60_000 });
      expect(await mk(f).getAccessToken()).toBe("at-old");
    });
  });

  describe("サインアウト", () => {
    const seed = () =>
      updateAuth((c) => ({
        ...c,
        account: {
          email: "me@example.com",
          subject: "user-1",
          clientId: CLIENT_ID,
          idToken: "old-id",
          accessToken: "at",
          refreshToken: "rt",
          expiresAt: Date.now() + 3600_000,
          scopes: SCOPE_FULL.split(" "),
          savedAt: 1,
        },
      }));

    it("失効に成功すれば revoked:true。トークンは消え、識別子は残り、次は再認可になる", async () => {
      const { f, calls } = makeFetch();
      seed();
      const m = mk(f);
      expect(await m.signOut()).toEqual({ revoked: true });
      const rev = calls.find((c) => c.url.endsWith("/oauth/revoke"));
      expect(rev?.body?.get("token")).toBe("rt");
      expect(rev?.body?.get("token_type_hint")).toBe("refresh_token");
      expect(m.getStatus().account).toBeNull();
      expect(loadAuth().account).toMatchObject({ clientId: CLIENT_ID, subject: "user-1", email: "me@example.com" });

      const { authUrl } = await m.startSignIn();
      const u = new URL(authUrl);
      expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
      expect(u.searchParams.get("agent_name_hint")).toBeNull();
      expect(u.searchParams.get("login_hint")).toBe("me@example.com");
      m.cancelSignIn();
    });

    it("失効を確認できなくてもローカルは消し revoked:false", async () => {
      const { f, state } = makeFetch();
      state.revokeStatus = 500;
      seed();
      const m = mk(f);
      expect(await m.signOut()).toEqual({ revoked: false });
      expect(m.getStatus().account).toBeNull();
    });

    it("別アカウントで承認され、保存済みがサインイン中なら何も消さず失敗にして、新しいトークンは失効する", async () => {
      const { f, state, calls } = makeFetch();
      seed();
      const m = mk(f);
      const { authUrl } = await m.startSignIn();
      state.nonce = new URL(authUrl).searchParams.get("nonce") as string;
      const other = idToken({ nonce: state.nonce, sub: "user-2" });
      state.tokenResponse = () =>
        new Response(JSON.stringify({ access_token: "x", refresh_token: "y", id_token: other, expires_in: 3600, scope: SCOPE_FULL }), { status: 200 });
      await callback(authUrl, { code: "abc" });
      await waitSettled(m);
      expect(m.getStatus().signIn.state).toBe("failed");
      expect(m.getStatus().signIn.error).toMatch(/sign out first/);
      expect(loadAuth().account).toMatchObject({ subject: "user-1", accessToken: "at", refreshToken: "rt" });
      expect(calls.some((c) => c.url.endsWith("/oauth/revoke") && c.body?.get("token") === "y")).toBe(true);
    });

    it("callback のあとで取り消したら保存せず、state も上書きせず、受け取ったトークンを失効する", async () => {
      const { f, state, calls } = makeFetch();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = (async (u: string, i: RequestInit) => {
        if (String(i.body).includes("grant_type=authorization_code")) await gate;
        return f(u, i);
      }) as unknown as typeof fetch;
      const m = mk(slow);
      const { authUrl } = await m.startSignIn();
      state.nonce = new URL(authUrl).searchParams.get("nonce") as string;
      const cb = callback(authUrl, { code: "abc", client_id: CLIENT_ID });
      await new Promise((r) => setTimeout(r, 30));
      m.cancelSignIn();
      release();
      await cb.catch(() => undefined);
      await new Promise((r) => setTimeout(r, 50));
      expect(m.getStatus().signIn.state).toBe("idle");
      expect(loadAuth().account).toBeNull();
      expect(calls.some((c) => c.url.endsWith("/oauth/revoke") && c.body?.get("token") === "rt-0")).toBe(true);
    });

    it("再認可で別アカウントなら拒否し、古い登録を捨てて次回は新しい登録にする", async () => {
      const { f, state } = makeFetch();
      seed();
      updateAuth((c) => ({ ...c, account: { ...(c.account as object), accessToken: undefined, refreshToken: undefined } as never }));
      const m = mk(f);
      const { authUrl } = await m.startSignIn();
      state.nonce = new URL(authUrl).searchParams.get("nonce") as string;
      const other = idToken({ nonce: state.nonce, sub: "user-2" });
      state.tokenResponse = () =>
        new Response(
          JSON.stringify({ access_token: "x", refresh_token: "y", id_token: other, expires_in: 3600, scope: SCOPE_FULL }),
          { status: 200 },
        );
      await callback(authUrl, { code: "abc" });
      await waitSettled(m);
      expect(m.getStatus().signIn.state).toBe("failed");
      // 別アカウントのトークンは保存せず、元のアカウントに結び付いた登録も残さない
      expect(loadAuth().account).toBeNull();
      const next = await m.startSignIn();
      expect(new URL(next.authUrl).searchParams.get("client_id")).toBe("dynamic_agent_client");
      m.cancelSignIn();
    });
  });

  it("Web 実行の getStatus はファイルに触れず、available:false を返す", () => {
    setServerMode("vercel");
    const m = mk(makeFetch().f);
    expect(m.getStatus()).toEqual({ available: false, signIn: { state: "idle", error: null, errorCode: null }, account: null });
    expect(existsSync(join(dir, "chatgpt-plan"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")("読み取りに失敗しても getStatus は投げず、startSignIn は失敗しても idle に戻る", async () => {
    if (process.getuid?.() === 0) return;
    mkdirSync(join(dir, "chatgpt-plan"), { recursive: true });
    const file = join(dir, "chatgpt-plan", "auth.json");
    writeFileSync(file, JSON.stringify({ hostId: "urn:uuid:x", account: null }));
    chmodSync(file, 0o000);
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const m = mk(makeFetch().f);
      expect(m.getStatus().account).toBeNull();
      expect(warn).toHaveBeenCalled();
      await expect(m.startSignIn()).rejects.toThrow();
      expect(m.getStatus().signIn.state).toBe("idle");
    } finally {
      chmodSync(file, 0o600);
    }
    expect(JSON.parse(readFileSync(file, "utf-8")).hostId).toBe("urn:uuid:x");
  });

  it("welcomed の印を保存し status に出る", async () => {
    const m = mk(makeFetch().f);
    updateAuth((c) => ({
      ...c,
      account: { email: null, subject: "s", clientId: CLIENT_ID, accessToken: "a", savedAt: 1, scopes: [] },
    }));
    expect(m.getStatus().account?.welcomed).toBe(false);
    m.markWelcomed();
    expect(m.getStatus().account?.welcomed).toBe(true);
  });
});
