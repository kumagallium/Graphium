import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "./index";

const ORIGIN = "https://kumagallium.github.io";
const env: Env = {
  ALLOWED_ORIGINS: ORIGIN,
  GOOGLE_CLIENT_ID: "cid",
  GOOGLE_CLIENT_SECRET: "csecret",
};
const SCOPE = "https://www.googleapis.com/auth/drive.file";

function req(path: string, body: unknown, opts: { headers?: Record<string, string | null>; method?: string; raw?: string } = {}) {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "x-requested-with": "graphium",
    "content-type": "application/json",
  };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return new Request("https://broker.example" + path, {
    method: opts.method ?? "POST",
    headers,
    body: opts.raw ?? JSON.stringify(body),
  });
}

const gres = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("token broker", () => {
  it("Origin 不一致・欠落は 403", async () => {
    const f = vi.fn();
    expect((await handleRequest(req("/exchange", { code: "a" }, { headers: { origin: "https://evil.example" } }), env, f)).status).toBe(403);
    expect((await handleRequest(req("/exchange", { code: "a" }, { headers: { origin: null } }), env, f)).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it("X-Requested-With 欠落は 403", async () => {
    const r = await handleRequest(req("/exchange", { code: "a" }, { headers: { "x-requested-with": null } }), env, vi.fn());
    expect(r.status).toBe(403);
  });

  it("Content-Type 違いは 415", async () => {
    const r = await handleRequest(req("/exchange", { code: "a" }, { headers: { "content-type": "text/plain" } }), env, vi.fn());
    expect(r.status).toBe(415);
  });

  it("大きすぎる body は 413", async () => {
    const r = await handleRequest(req("/exchange", { code: "a".repeat(5000) }), env, vi.fn());
    expect(r.status).toBe(413);
  });

  it("JSON でない・code が不正は 400", async () => {
    expect((await handleRequest(req("/exchange", null, { raw: "{" }), env, vi.fn())).status).toBe(400);
    expect((await handleRequest(req("/exchange", { code: "" }), env, vi.fn())).status).toBe(400);
    expect((await handleRequest(req("/exchange", { code: "a".repeat(2049) }), env, vi.fn())).status).toBe(400);
  });

  it("/exchange 成功で 3 フィールドだけ返り、form の中身が正しい", async () => {
    const f = vi.fn().mockResolvedValue(
      gres({ access_token: "at", expires_in: 3599, refresh_token: "rt", id_token: "idt", scope: SCOPE, token_type: "Bearer" }),
    );
    const r = await handleRequest(req("/exchange", { code: "abc" }), env, f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ access_token: "at", expires_in: 3599, refresh_token: "rt" });
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(r.headers.get("vary")).toBe("Origin");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("abc");
    expect(form.get("redirect_uri")).toBe("postmessage");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
  });

  it("リクエストの url / client_id / scope などは無視される", async () => {
    const f = vi.fn().mockResolvedValue(gres({ access_token: "at", expires_in: 1, scope: SCOPE, refresh_token: "rt" }));
    await handleRequest(
      req("/exchange", { code: "abc", url: "https://evil.example", client_id: "x", redirect_uri: "y", grant_type: "z", scope: "all" }),
      env,
      f,
    );
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("redirect_uri")).toBe("postmessage");
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.has("scope")).toBe(false);
    expect(form.has("url")).toBe(false);
  });

  it("/refresh は access_token と expires_in だけ返す（scope 無しは通す）", async () => {
    const f = vi.fn().mockResolvedValue(gres({ access_token: "at", expires_in: 10, id_token: "x" }));
    const r = await handleRequest(req("/refresh", { refresh_token: "rt" }), env, f);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ access_token: "at", expires_in: 10 });
    expect(new URLSearchParams(f.mock.calls[0][1].body as string).get("grant_type")).toBe("refresh_token");
  });

  it("scope が広いと 403 で revoke が呼ばれる", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(gres({ access_token: "at", expires_in: 1, refresh_token: "rt", scope: `${SCOPE} https://www.googleapis.com/auth/drive` }))
      .mockResolvedValueOnce(new Response("{}"));
    const r = await handleRequest(req("/exchange", { code: "abc" }), env, f);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "scope_not_allowed" });
    expect(f.mock.calls[1][0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(f.mock.calls[1][1].body as string).get("token")).toBe("rt");
  });

  it("invalid_grant は 400 で error コードだけ返す", async () => {
    const f = vi.fn().mockResolvedValue(gres({ error: "invalid_grant", error_description: "secret detail" }, 400));
    const r = await handleRequest(req("/refresh", { refresh_token: "rt" }), env, f);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "invalid_grant" });
  });

  it("upstream 失敗・5xx は 502", async () => {
    const f1 = vi.fn().mockRejectedValue(new Error("net"));
    expect((await handleRequest(req("/refresh", { refresh_token: "rt" }), env, f1)).status).toBe(502);
    const f2 = vi.fn().mockResolvedValue(gres({}, 503));
    const r = await handleRequest(req("/refresh", { refresh_token: "rt" }), env, f2);
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ error: "upstream_unavailable" });
  });

  it("preflight に答える", async () => {
    const r = await handleRequest(
      new Request("https://broker.example/exchange", { method: "OPTIONS", headers: { origin: ORIGIN } }),
      env,
      vi.fn(),
    );
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(r.headers.get("access-control-allow-headers")).toBe("content-type, x-requested-with");
  });

  it("未知のパスは 404・GET は 405", async () => {
    expect((await handleRequest(req("/other", {}), env, vi.fn())).status).toBe(404);
    expect((await handleRequest(req("/exchange", undefined, { method: "GET", raw: undefined as unknown as string }), env, vi.fn())).status).toBe(405);
  });

  it("未設定は 500", async () => {
    const r = await handleRequest(req("/exchange", { code: "a" }), { ALLOWED_ORIGINS: ORIGIN }, vi.fn());
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ error: "not_configured" });
  });

  it("/refresh で scope が広いと refresh_token を revoke して 403", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(gres({ access_token: "at", expires_in: 1, scope: "https://www.googleapis.com/auth/drive" }))
      .mockResolvedValueOnce(new Response("{}"));
    const r = await handleRequest(req("/refresh", { refresh_token: "rt-in" }), env, f);
    expect(r.status).toBe(403);
    expect(f.mock.calls[1][0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(f.mock.calls[1][1].body as string).get("token")).toBe("rt-in");
  });

  it("Content-Length 無しの大きなストリームは全量を読まず 413", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent >= 1000) return c.close();
        sent++;
        c.enqueue(chunk);
      },
    });
    const request = new Request("https://broker.example/exchange", {
      method: "POST",
      headers: { origin: ORIGIN, "x-requested-with": "graphium", "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    const r = await handleRequest(request, env, vi.fn());
    expect(r.status).toBe(413);
    expect(sent).toBeLessThan(20);
  });

  describe("レート制限", () => {
    it("拒否されたら 429 で Google を呼ばない", async () => {
      const f = vi.fn();
      const e = { ...env, RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) } };
      const r = await handleRequest(req("/exchange", { code: "a" }, { headers: { "cf-connecting-ip": "1.2.3.4" } }), e, f);
      expect(r.status).toBe(429);
      expect(await r.json()).toEqual({ error: "rate_limited" });
      expect(e.RATE_LIMITER.limit).toHaveBeenCalledWith({ key: "1.2.3.4" });
      expect(f).not.toHaveBeenCalled();
    });
    const ok = () => vi.fn().mockResolvedValue(gres({ access_token: "at", expires_in: 1 }));
    it("許可されたら通る", async () => {
      const e = { ...env, RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) } };
      expect((await handleRequest(req("/refresh", { refresh_token: "rt" }), e, ok())).status).toBe(200);
    });
    it("バインディング無しなら通る", async () => {
      expect((await handleRequest(req("/refresh", { refresh_token: "rt" }), env, ok())).status).toBe(200);
    });
    it("limit が例外でも通る", async () => {
      const e = { ...env, RATE_LIMITER: { limit: vi.fn().mockRejectedValue(new Error("x")) } };
      expect((await handleRequest(req("/refresh", { refresh_token: "rt" }), e, ok())).status).toBe(200);
    });
  });
});
