// @vitest-environment jsdom
// stay（つないだまま）方式の認可のテスト。gsi（code client）と broker（fetch）はモック。
//
// 対象の不変条件:
// - connectInteractive は同期的に requestCode まで到達する（ジェスチャ契約）
// - code を broker /exchange で交換して保存する。refresh_token 無しでも成功する。失敗は PushAuthError
// - getFreshAccessToken: 期限内はそのまま・期限切れで /refresh・同時呼び出しは 1 本・
//   invalid_grant は全消去して null・一時的な不調は refresh token を残して PushAuthError
// - broker へ必須ヘッダ（Content-Type / X-Requested-With）を付ける
// - invalidate は refresh token を残す・disconnect は両方式を消す

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const STAY_KEY = "graphium-push-google-stay";
const HOURLY_KEY = "graphium-push-google-token";
const BROKER = "https://broker.example";

type CodeCb = (resp: { code?: string; error?: string; error_description?: string }) => void;
type ErrCb = (err: { type?: string; message?: string }) => void;

let codeCb: CodeCb | null = null;
let errCb: ErrCb | null = null;
const requestCode = vi.fn();
const initCodeClient = vi.fn(
  (config: { client_id: string; scope: string; ux_mode: string; callback: CodeCb; error_callback?: ErrCb }) => {
    codeCb = config.callback;
    errCb = config.error_callback ?? null;
    return { requestCode };
  },
);

function installGsi() {
  (window as unknown as { google: unknown }).google = {
    accounts: { oauth2: { initCodeClient, initTokenClient: vi.fn() } },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchCall = { url: string; init: RequestInit | undefined };
function stubFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", mock);
  return calls;
}

async function fresh() {
  vi.resetModules();
  const config = await import("./config");
  config.__setStayDefaultsForTest({ clientId: "stay-client", brokerUrl: BROKER });
  const auth = await import("./google-auth");
  return auth;
}

function storedStay() {
  const raw = localStorage.getItem(STAY_KEY);
  return raw ? (JSON.parse(raw) as { refreshToken?: string; accessToken?: string; expiresAt?: number }) : null;
}

function seedStay(value: { refreshToken?: string; accessToken?: string; expiresAt?: number }) {
  localStorage.setItem(STAY_KEY, JSON.stringify(value));
}

beforeEach(() => {
  localStorage.clear();
  codeCb = null;
  errCb = null;
  requestCode.mockClear();
  initCodeClient.mockClear();
  installGsi();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { google?: unknown }).google;
});

describe("stay: prepare / connectInteractive", () => {
  it("prepare creates a code client (popup, drive.file) without opening anything", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    expect(initCodeClient).toHaveBeenCalledTimes(1);
    expect(initCodeClient.mock.calls[0][0]).toMatchObject({
      client_id: "stay-client",
      scope: "https://www.googleapis.com/auth/drive.file",
      ux_mode: "popup",
    });
    expect(requestCode).not.toHaveBeenCalled();
    expect(auth.isAuthPrepared()).toBe(true);
  });

  it("calls requestCode synchronously inside connectInteractive (gesture contract)", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    const promise = auth.connectInteractive();
    expect(requestCode).toHaveBeenCalledTimes(1); // await を挟まず同期で到達
    stubFetch(() => json({ access_token: "a", expires_in: 3600, refresh_token: "r" }));
    codeCb?.({ code: "code-1" });
    await promise;
  });

  it("rejects immediately when not prepared", async () => {
    const auth = await fresh();
    await expect(auth.connectInteractive()).rejects.toMatchObject({ name: "PushConfigError" });
  });

  it("double taps share one request", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    const p1 = auth.connectInteractive();
    const p2 = auth.connectInteractive();
    expect(p2).toBe(p1);
    expect(requestCode).toHaveBeenCalledTimes(1);
    stubFetch(() => json({ access_token: "a", expires_in: 3600, refresh_token: "r" }));
    codeCb?.({ code: "c" });
    await p1;
  });

  it("exchanges the code at the broker and stores refresh + access tokens", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    const calls = stubFetch(() => json({ access_token: "acc-1", expires_in: 3600, refresh_token: "ref-1" }));
    const promise = auth.connectInteractive();
    codeCb?.({ code: "code-xyz" });
    await expect(promise).resolves.toBe("acc-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BROKER}/exchange`);
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ code: "code-xyz" });
    expect(storedStay()).toMatchObject({ refreshToken: "ref-1", accessToken: "acc-1" });
    expect(auth.hasGoogleConnection("stay")).toBe(true);
  });

  it("still succeeds without a refresh_token (access token only, usable for about an hour)", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    stubFetch(() => json({ access_token: "acc-2", expires_in: 3600 }));
    const promise = auth.connectInteractive();
    codeCb?.({ code: "c" });
    await expect(promise).resolves.toBe("acc-2");
    expect(storedStay()?.refreshToken).toBeUndefined();
    expect(storedStay()?.accessToken).toBe("acc-2");
    expect(auth.hasGoogleConnection("stay")).toBe(true);
  });

  it("rejects with PushAuthError when the broker fails, without leaking secrets in the message", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    stubFetch(() => json({ error: "scope_not_allowed" }, 403));
    const promise = auth.connectInteractive();
    codeCb?.({ code: "secret-code-123" });
    const err = await promise.catch((e) => e);
    expect(err).toMatchObject({ name: "PushAuthError" });
    expect(String(err.message)).not.toContain("secret-code-123");
    expect(storedStay()).toBeNull();
  });

  it("rejects with PushAuthError on a network failure at the broker", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const promise = auth.connectInteractive();
    codeCb?.({ code: "c" });
    await expect(promise).rejects.toMatchObject({ name: "PushAuthError" });
  });

  it("rejects with PushAuthError when GIS reports an error or the popup is closed", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    const p1 = auth.connectInteractive();
    codeCb?.({ error: "access_denied" });
    await expect(p1).rejects.toMatchObject({ name: "PushAuthError" });

    const p2 = auth.connectInteractive();
    errCb?.({ type: "popup_closed" });
    await expect(p2).rejects.toMatchObject({ name: "PushAuthError" });
  });
});

describe("stay: getFreshAccessToken", () => {
  it("returns the stored access token while it is within its lifetime (no broker call)", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "r", accessToken: "a", expiresAt: Date.now() + 10 * 60 * 1000 });
    const calls = stubFetch(() => json({}));
    await expect(auth.getFreshAccessToken("stay")).resolves.toBe("a");
    expect(calls).toHaveLength(0);
  });

  it("refreshes via /refresh when expired (inside the 60 s margin counts as expired) and saves the result", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "ref-1", accessToken: "old", expiresAt: Date.now() + 30 * 1000 });
    const calls = stubFetch(() => json({ access_token: "new", expires_in: 3600 }));
    await expect(auth.getFreshAccessToken("stay")).resolves.toBe("new");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BROKER}/refresh`);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ refresh_token: "ref-1" });
    expect(storedStay()).toMatchObject({ refreshToken: "ref-1", accessToken: "new" });
  });

  it("sends the required headers to the broker", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "r" });
    const calls = stubFetch(() => json({ access_token: "n", expires_in: 3600 }));
    await auth.getFreshAccessToken("stay");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Requested-With"]).toBe("graphium");
  });

  it("coalesces concurrent calls into a single /refresh", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "r" });
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const calls = stubFetch(async () => {
      await gate;
      return json({ access_token: "n", expires_in: 3600 });
    });
    const p1 = auth.getFreshAccessToken("stay");
    const p2 = auth.getFreshAccessToken("stay");
    release();
    await expect(Promise.all([p1, p2])).resolves.toEqual(["n", "n"]);
    expect(calls).toHaveLength(1);
  });

  it("clears everything and returns null on invalid_grant (reconnect needed)", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "r", accessToken: "a", expiresAt: 1 });
    stubFetch(() => json({ error: "invalid_grant" }, 400));
    await expect(auth.getFreshAccessToken("stay")).resolves.toBeNull();
    expect(localStorage.getItem(STAY_KEY)).toBeNull();
    expect(auth.hasGoogleConnection("stay")).toBe(false);
  });

  it.each([
    ["502 upstream_unavailable", () => json({ error: "upstream_unavailable" }, 502)],
    ["403 scope_not_allowed", () => json({ error: "scope_not_allowed" }, 403)],
    ["429", () => new Response("slow down", { status: 429 })],
    ["500", () => new Response("oops", { status: 500 })],
    ["400 other than invalid_grant", () => json({ error: "invalid_request" }, 400)],
  ])("keeps the refresh token and raises PushAuthError on %s", async (_label, make) => {
    const auth = await fresh();
    seedStay({ refreshToken: "keep-me" });
    stubFetch(make);
    await expect(auth.getFreshAccessToken("stay")).rejects.toMatchObject({ name: "PushAuthError" });
    expect(storedStay()?.refreshToken).toBe("keep-me");
    expect(auth.hasGoogleConnection("stay")).toBe(true);
  });

  it("keeps the refresh token and raises PushAuthError on a network failure", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "keep-me" });
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    await expect(auth.getFreshAccessToken("stay")).rejects.toMatchObject({ name: "PushAuthError" });
    expect(storedStay()?.refreshToken).toBe("keep-me");
  });

  it("aborts the broker request after 15 seconds", async () => {
    vi.useFakeTimers();
    const auth = await fresh();
    seedStay({ refreshToken: "keep-me" });
    stubFetch(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          (call.init?.signal as AbortSignal).addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const promise = auth.getFreshAccessToken("stay");
    const settled = promise.catch((e) => e);
    await vi.advanceTimersByTimeAsync(15 * 1000);
    await expect(settled).resolves.toMatchObject({ name: "PushAuthError" });
    expect(storedStay()?.refreshToken).toBe("keep-me");
  });

  it("returns null when there is nothing stored", async () => {
    const auth = await fresh();
    await expect(auth.getFreshAccessToken("stay")).resolves.toBeNull();
  });

  it("hourly mode behaves as before (getValidAccessToken)", async () => {
    const auth = await fresh();
    localStorage.setItem(HOURLY_KEY, JSON.stringify({ accessToken: "h", expiresAt: Date.now() + 600000 }));
    await expect(auth.getFreshAccessToken("hourly")).resolves.toBe("h");
    expect(auth.hasGoogleConnection("hourly")).toBe(true);
  });
});

describe("stay: invalidate / disconnect", () => {
  it("invalidateAccessToken(stay) drops the access token but keeps the refresh token", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "r", accessToken: "a", expiresAt: Date.now() + 600000 });
    auth.invalidateAccessToken("stay");
    expect(storedStay()).toEqual({ refreshToken: "r" });
    expect(auth.hasGoogleConnection("stay")).toBe(true);
  });

  it("disconnectGoogleAuth clears both modes and revokes best-effort", async () => {
    const auth = await fresh();
    seedStay({ refreshToken: "stay-r", accessToken: "stay-a", expiresAt: Date.now() + 600000 });
    localStorage.setItem(HOURLY_KEY, JSON.stringify({ accessToken: "hourly-a", expiresAt: Date.now() + 600000 }));
    const calls = stubFetch(() => new Response("", { status: 200 }));
    auth.disconnectGoogleAuth();
    expect(localStorage.getItem(STAY_KEY)).toBeNull();
    expect(localStorage.getItem(HOURLY_KEY)).toBeNull();
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("https://oauth2.googleapis.com/revoke?token=stay-r"); // refresh token を優先
    expect(urls).toContain("https://oauth2.googleapis.com/revoke?token=hourly-a");
    expect(urls).not.toContain("https://oauth2.googleapis.com/revoke?token=stay-a");
  });
});

describe("切断と進行中の処理の競合", () => {
  const REVOKE = "https://oauth2.googleapis.com/revoke?token=";

  it("(a) an old refresh returning invalid_grant after disconnect + reconnect does not wipe the new connection", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    seedStay({ refreshToken: "old-r" });
    let rejectOld!: () => void;
    const gate = new Promise<void>((res) => { rejectOld = res; });
    const calls = stubFetch(async (call) => {
      if (call.url.endsWith("/refresh")) {
        await gate;
        return json({ error: "invalid_grant" }, 400);
      }
      if (call.url.endsWith("/exchange")) return json({ access_token: "new-a", expires_in: 3600, refresh_token: "new-r" });
      return new Response("", { status: 200 }); // revoke
    });
    const refreshing = auth.getFreshAccessToken("stay");
    auth.disconnectGoogleAuth();
    const connecting = auth.connectInteractive();
    codeCb?.({ code: "c" });
    await connecting;
    expect(storedStay()?.refreshToken).toBe("new-r");
    rejectOld();
    await expect(refreshing).resolves.toBeNull();
    expect(storedStay()?.refreshToken).toBe("new-r");
    expect(calls.length).toBeGreaterThan(0);
  });

  it("(b) a disconnect during the code exchange: nothing is saved, the keys are revoked, and connect rejects", async () => {
    const auth = await fresh();
    await auth.prepareGoogleAuth("stay-client", "stay");
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const calls = stubFetch(async (call) => {
      if (call.url.endsWith("/exchange")) {
        await gate;
        return json({ access_token: "acc", expires_in: 3600, refresh_token: "ref" });
      }
      return new Response("", { status: 200 });
    });
    const promise = auth.connectInteractive();
    const settled = promise.catch((e) => e);
    codeCb?.({ code: "c" });
    auth.disconnectGoogleAuth();
    release();
    await expect(settled).resolves.toMatchObject({ name: "PushAuthError" });
    expect(localStorage.getItem(STAY_KEY)).toBeNull();
    expect(calls.map((c) => c.url)).toContain(`${REVOKE}ref`);
  });

  it("(c) hourly: a token arriving after a disconnect is not saved and is revoked", async () => {
    vi.resetModules();
    const initTokenClient = vi.fn();
    type TokenCb = (r: { access_token?: string; expires_in?: number }) => void;
    const holder: { cb: TokenCb | null } = { cb: null };
    initTokenClient.mockImplementation((c: { callback: TokenCb }) => {
      holder.cb = c.callback;
      return { requestAccessToken: vi.fn() };
    });
    (window as unknown as { google: unknown }).google = {
      accounts: { oauth2: { initTokenClient, initCodeClient } },
    };
    const auth = await import("./google-auth");
    await auth.prepareGoogleAuth("hourly-client", "hourly");
    const calls = stubFetch(() => new Response("", { status: 200 }));
    const promise = auth.connectInteractive();
    const settled = promise.catch((e) => e);
    auth.disconnectGoogleAuth();
    holder.cb?.({ access_token: "late-tok", expires_in: 3600 });
    await expect(settled).resolves.toMatchObject({ name: "PushAuthError" });
    expect(localStorage.getItem(HOURLY_KEY)).toBeNull();
    expect(calls.map((c) => c.url)).toContain(`${REVOKE}late-tok`);
  });

  it("the broker timeout also covers a response body that never finishes", async () => {
    vi.useFakeTimers();
    const auth = await fresh();
    seedStay({ refreshToken: "keep-me" });
    stubFetch((call) => {
      const signal = call.init?.signal as AbortSignal;
      const body = new ReadableStream({
        start(controller) {
          signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    });
    const settled = auth.getFreshAccessToken("stay").catch((e) => e);
    await vi.advanceTimersByTimeAsync(15 * 1000);
    await expect(settled).resolves.toMatchObject({ name: "PushAuthError" });
    expect(storedStay()?.refreshToken).toBe("keep-me");
  });
});
