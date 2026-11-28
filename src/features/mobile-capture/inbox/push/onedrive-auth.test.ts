// @vitest-environment jsdom
// OneDrive（個人の Microsoft アカウント）認可コード + PKCE のテスト。
// 窓・BroadcastChannel・/token はモック。
//
// 対象の不変条件:
// - connectInteractive は **同期的に** window.open まで到達する（準備未了なら即 reject）
// - 戻りは state が一致したものだけ採る（不一致・別オリジンの message は無視）
// - 更新用の鍵での取り直しは単一飛行で、新しい refresh_token を保存し、
//   refreshExpiresAt（対話でつないだ時刻 + 24 時間）は延ばさない
// - invalid_grant（400）で鍵を破棄、ネットワーク失敗では鍵を残して throw
//
// モジュール状態を持つので、各テストで vi.resetModules + 動的 import して独立させる。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const TOKEN_KEY = "graphium-push-onedrive-token";
const LINKED_KEY = "graphium-push-onedrive-linked";
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const CHANNEL = "graphium-onedrive-auth";
const DAY_MS = 24 * 60 * 60 * 1000;

/** 同一オリジンの BroadcastChannel の代用（テスト内のバス）。 */
const channels = new Set<FakeBroadcastChannel>();
class FakeBroadcastChannel {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) {
    channels.add(this);
  }
  postMessage(data: unknown) {
    for (const c of channels) {
      if (c !== this && c.name === this.name) c.onmessage?.({ data });
    }
  }
  close() {
    channels.delete(this);
  }
}

/** 戻り先ページがやることの代用。 */
function sendReturn(payload: Record<string, unknown>) {
  new FakeBroadcastChannel(CHANNEL).postMessage({ type: CHANNEL, ...payload });
}

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function tokenResponse(body: unknown, status = 200): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FakeResponse>>();
const openMock = vi.fn();
let popup: { closed: boolean; close: ReturnType<typeof vi.fn> };

async function freshAuth() {
  vi.resetModules();
  return await import("./onedrive-auth");
}

/** 準備 → 接続開始 → 窓の URL から state を取り出す。 */
async function startConnect(auth: Awaited<ReturnType<typeof freshAuth>>) {
  await auth.prepareOneDriveAuth(CLIENT_ID);
  const promise = auth.connectInteractive();
  const url = new URL(openMock.mock.calls[0][0] as string);
  return { promise, url, state: url.searchParams.get("state") as string };
}

function storedToken() {
  const raw = localStorage.getItem(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as Record<string, number | string>) : null;
}

function seedToken(overrides: Record<string, unknown> = {}) {
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      accessToken: "at-old",
      expiresAt: Date.now() - 1000,
      refreshToken: "rt-old",
      refreshExpiresAt: Date.now() + 5 * 60 * 60 * 1000,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("graphium-push-onedrive-client-id", CLIENT_ID);
  channels.clear();
  fetchMock.mockReset();
  openMock.mockReset();
  popup = { closed: false, close: vi.fn() };
  openMock.mockReturnValue(popup);
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "open").mockImplementation(openMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("準備と同期の window.open", () => {
  it("is not prepared until prepareOneDriveAuth resolves", async () => {
    const auth = await freshAuth();
    expect(auth.isOneDriveAuthPrepared()).toBe(false);
    await auth.prepareOneDriveAuth(CLIENT_ID);
    expect(auth.isOneDriveAuthPrepared()).toBe(true);
  });

  it("rejects without opening a window when not prepared", async () => {
    const auth = await freshAuth();
    await expect(auth.connectInteractive()).rejects.toThrow(/not prepared/);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("calls window.open synchronously, before any await", async () => {
    const auth = await freshAuth();
    await auth.prepareOneDriveAuth(CLIENT_ID);
    const promise = auth.connectInteractive();
    // await を挟まずに確認できる = 同期で開いている
    expect(openMock).toHaveBeenCalledTimes(1);
    promise.catch(() => {});
  });

  it("asks which account to use on a first connect, but not when renewing", async () => {
    // 初回（印なし）: アカウントを選ぶ画面を出す。出さないと別のアカウントへ替えられない
    const auth = await freshAuth();
    const first = await startConnect(auth);
    first.promise.catch(() => {});
    expect(first.url.searchParams.get("prompt")).toBe("select_account");

    // 取り直し（つないだ印あり）: 選ぶ画面は出さない
    openMock.mockClear();
    localStorage.setItem("graphium-push-onedrive-linked", "1");
    const auth2 = await freshAuth();
    const renew = await startConnect(auth2);
    renew.promise.catch(() => {});
    expect(renew.url.searchParams.get("prompt")).toBeNull();

    // 切断すると印が消え、次の接続ではまた選ぶ画面が出る
    openMock.mockClear();
    auth2.disconnectOneDriveAuth();
    const auth3 = await freshAuth();
    const again = await startConnect(auth3);
    again.promise.catch(() => {});
    expect(again.url.searchParams.get("prompt")).toBe("select_account");
  });

  it("builds a PKCE authorize URL with the fixed redirect and no secret", async () => {
    const auth = await freshAuth();
    const { url, promise } = await startConnect(auth);
    promise.catch(() => {});

    expect(`${url.origin}${url.pathname}`).toBe(
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    );
    const q = url.searchParams;
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("response_mode")).toBe("fragment");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("scope")).toBe("Files.ReadWrite.AppFolder offline_access");
    expect(q.get("redirect_uri")).toBe(auth.getOneDriveRedirectUri());
    expect(q.get("redirect_uri")).toMatch(/\/app\/auth\/onedrive\.html$/);
    expect(q.has("client_secret")).toBe(false);
  });

  it("rejects when the window could not be opened, keeping the prepared pair", async () => {
    const auth = await freshAuth();
    await auth.prepareOneDriveAuth(CLIENT_ID);
    openMock.mockReturnValueOnce(null);
    await expect(auth.connectInteractive()).rejects.toThrow(/could not be opened/);
    expect(auth.isOneDriveAuthPrepared()).toBe(true);
  });

  it("joins a double tap onto the same request", async () => {
    const auth = await freshAuth();
    const { promise } = await startConnect(auth);
    const second = auth.connectInteractive();
    expect(second).toBe(promise);
    expect(openMock).toHaveBeenCalledTimes(1);
    promise.catch(() => {});
  });
});

describe("戻りの検証とコード交換", () => {
  it("ignores a return whose state does not match, then accepts the right one", async () => {
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    let settled = false;
    promise.then(() => (settled = true), () => (settled = true));

    sendReturn({ code: "evil-code", state: "someone-elses-state" });
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    );
    sendReturn({ code: "good-code", state });
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("good-code");
    expect(body.get("client_id")).toBe(CLIENT_ID);
    expect(body.get("redirect_uri")).toBe(auth.getOneDriveRedirectUri());
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.has("client_secret")).toBe(false);
  });

  it("stores keys with refreshExpiresAt = now + 24h and marks the device as linked", async () => {
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    );
    const t0 = Date.now();
    sendReturn({ code: "c", state });
    await promise;

    const stored = storedToken();
    expect(stored?.accessToken).toBe("at-1");
    expect(stored?.refreshToken).toBe("rt-1");
    expect(stored?.expiresAt).toBe(t0 + 3600 * 1000);
    expect(stored?.refreshExpiresAt).toBe(t0 + DAY_MS);
    expect(localStorage.getItem(LINKED_KEY)).toBe("1");
    expect(auth.isConnected()).toBe(true);
    expect(auth.hasLinkedBefore()).toBe(true);
  });

  it("accepts a postMessage from the same origin and ignores other origins", async () => {
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    let settled = false;
    promise.then(() => (settled = true), () => (settled = true));

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: CHANNEL, code: "x", state },
        origin: "https://evil.example",
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: CHANNEL, code: "x", state },
        origin: window.location.origin,
      }),
    );
    await promise;
    expect(storedToken()?.accessToken).toBe("at-2");
  });

  it("rejects when the return carries an error with the right state", async () => {
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    const assertion = expect(promise).rejects.toThrow(/user said no/);
    sendReturn({ error: "access_denied", error_description: "user said no", state });
    await assertion;
    expect(storedToken()).toBeNull();
  });

  it("rejects when the window is closed without a return", async () => {
    const auth = await freshAuth();
    const { promise } = await startConnect(auth);
    const assertion = expect(promise).rejects.toThrow(/closed/);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
  });

  it("rejects after the time limit", async () => {
    const auth = await freshAuth();
    const { promise } = await startConnect(auth);
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 10);
    await assertion;
  });

  it("uses a fresh PKCE pair for the next connect", async () => {
    const auth = await freshAuth();
    const first = await startConnect(auth);
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600 }),
    );
    sendReturn({ code: "c", state: first.state });
    await first.promise;
    // 終わったら次の組が作り直される
    await vi.advanceTimersByTimeAsync(10);
    expect(auth.isOneDriveAuthPrepared()).toBe(true);

    openMock.mockClear();
    const second = auth.connectInteractive();
    const url2 = new URL(openMock.mock.calls[0][0] as string);
    expect(url2.searchParams.get("state")).not.toBe(first.state);
    second.catch(() => {});
  });
});

describe("更新用の鍵での取り直し", () => {
  it("returns a live access token without calling /token", async () => {
    const auth = await freshAuth();
    seedToken({ accessToken: "at-live", expiresAt: Date.now() + 30 * 60 * 1000 });
    await expect(auth.getValidAccessToken()).resolves.toBe("at-live");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes single-flight, stores the new refresh_token, and does not extend refreshExpiresAt", async () => {
    const auth = await freshAuth();
    const refreshExpiresAt = Date.now() + 5 * 60 * 60 * 1000;
    seedToken({ refreshExpiresAt });
    let resolveFetch!: (r: FakeResponse) => void;
    fetchMock.mockReturnValueOnce(new Promise((res) => (resolveFetch = res)));

    const a = auth.getValidAccessToken();
    const b = auth.getValidAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFetch(tokenResponse({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 }));
    await expect(Promise.all([a, b])).resolves.toEqual(["at-new", "at-new"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-old");
    expect(body.get("client_id")).toBe(CLIENT_ID);

    const stored = storedToken();
    expect(stored?.refreshToken).toBe("rt-new");
    expect(stored?.accessToken).toBe("at-new");
    // 更新しても 24 時間は延びない
    expect(stored?.refreshExpiresAt).toBe(refreshExpiresAt);
  });

  it("keeps the old refresh_token when the response omits a new one", async () => {
    const auth = await freshAuth();
    seedToken();
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "at-new", expires_in: 3600 }));
    await auth.getValidAccessToken();
    expect(storedToken()?.refreshToken).toBe("rt-old");
  });

  it("discards the keys on invalid_grant (400) and returns null", async () => {
    const auth = await freshAuth();
    seedToken();
    fetchMock.mockResolvedValueOnce(tokenResponse({ error: "invalid_grant" }, 400));
    await expect(auth.getValidAccessToken()).resolves.toBeNull();
    expect(storedToken()).toBeNull();
    expect(auth.isConnected()).toBe(false);
  });

  it("keeps the keys and throws on a network failure", async () => {
    const auth = await freshAuth();
    seedToken();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(auth.getValidAccessToken()).rejects.toThrow(/Failed to fetch/);
    expect(storedToken()?.refreshToken).toBe("rt-old");
    // 次の呼び出しでまた取り直せる（単一飛行が詰まらない）
    fetchMock.mockResolvedValueOnce(tokenResponse({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }));
    await expect(auth.getValidAccessToken()).resolves.toBe("at-2");
  });

  it("keeps the keys on a 5xx", async () => {
    const auth = await freshAuth();
    seedToken();
    fetchMock.mockResolvedValueOnce(tokenResponse({}, 503));
    await expect(auth.getValidAccessToken()).rejects.toThrow(/503/);
    expect(storedToken()?.refreshToken).toBe("rt-old");
  });

  it("drops an expired refresh key without calling /token", async () => {
    const auth = await freshAuth();
    seedToken({ refreshExpiresAt: Date.now() - 1000 });
    await expect(auth.getValidAccessToken()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(storedToken()).toBeNull();
  });
});

describe("状態の読み取りと破棄", () => {
  it("reports connection by the refresh key and its remaining time", async () => {
    const auth = await freshAuth();
    expect(auth.isConnected()).toBe(false);
    expect(auth.getRefreshRemainingMs()).toBeNull();
    seedToken({ refreshExpiresAt: Date.now() + 90_000 });
    expect(auth.isConnected()).toBe(true);
    expect(auth.getRefreshRemainingMs()).toBe(90_000);
  });

  it("invalidateAccessToken drops only the access key", async () => {
    const auth = await freshAuth();
    seedToken({ accessToken: "at-live", expiresAt: Date.now() + 3600_000 });
    auth.invalidateAccessToken();
    const stored = storedToken();
    expect(stored?.accessToken).toBe("");
    expect(stored?.refreshToken).toBe("rt-old");
    expect(auth.isConnected()).toBe(true);
  });

  it("disconnect clears the keys and the linked mark without calling the network", async () => {
    const auth = await freshAuth();
    seedToken();
    localStorage.setItem(LINKED_KEY, "1");
    auth.disconnectOneDriveAuth();
    expect(storedToken()).toBeNull();
    expect(localStorage.getItem(LINKED_KEY)).toBeNull();
    expect(auth.hasLinkedBefore()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifies subscribers when keys are saved or dropped", async () => {
    const auth = await freshAuth();
    const { PUSH_STATUS_EVENT } = await import("../push-events");
    const handler = vi.fn();
    window.addEventListener(PUSH_STATUS_EVENT, handler);
    seedToken();
    auth.disconnectOneDriveAuth();
    window.removeEventListener(PUSH_STATUS_EVENT, handler);
    expect(handler).toHaveBeenCalled();
  });
});

describe("コンソールに秘密を出さない", () => {
  it("never logs codes, state or tokens during a full connect + refresh", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-secret", refresh_token: "rt-secret", expires_in: 1 }),
    );
    sendReturn({ code: "code-secret", state });
    await promise;
    await vi.advanceTimersByTimeAsync(5000);
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-secret2", refresh_token: "rt-secret2", expires_in: 3600 }),
    );
    await auth.getValidAccessToken();
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("切断・つなぎ直しとの競合", () => {
  it("does not store keys when disconnected while the sign-in window is open", async () => {
    const auth = await freshAuth();
    const { promise, state } = await startConnect(auth);
    const outcome = promise.then(() => "ok", (e: Error) => e.message);
    auth.disconnectOneDriveAuth();
    fetchMock.mockResolvedValueOnce(
      tokenResponse({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 }),
    );
    sendReturn({ code: "good-code", state });
    await expect(outcome).resolves.toBe("Disconnected while signing in");
    expect(storedToken()).toBeNull();
    expect(localStorage.getItem(LINKED_KEY)).toBeNull();
  });

  it("keeps a newer key when a refresh for the old key comes back invalid_grant", async () => {
    const auth = await freshAuth();
    seedToken();
    let resolveFetch!: (r: FakeResponse) => void;
    fetchMock.mockReturnValueOnce(new Promise((res) => (resolveFetch = res)));
    const pending = auth.getValidAccessToken();
    // 待っている間に、つなぎ直して新しい鍵に替わった
    seedToken({ accessToken: "at-fresh", refreshToken: "rt-fresh", expiresAt: Date.now() + 3600_000 });
    resolveFetch(tokenResponse({ error: "invalid_grant" }, 400));
    await expect(pending).resolves.toBeNull();
    expect(storedToken()?.refreshToken).toBe("rt-fresh");
  });
});
