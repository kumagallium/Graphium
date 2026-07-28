// @vitest-environment jsdom
// GIS token model 認可のテスト。gsi スクリプト/ネットワークはモック。
//
// 対象の不変条件:
// - prepare は gsi をロードして token client を作る（ポップアップは出さない）
// - connectInteractive は **同期的に** requestAccessToken まで到達する
//   （準備未了なら遅延ロードにフォールバックせず即 reject — ジェスチャ保護）
// - トークンは localStorage に永続化し、期限内（余裕 60 秒込み）なら再利用、
//   期限切れは読み出し時に破棄する
// - 二重タップは同じ要求に相乗りする（requestAccessToken は 1 回）
//
// モジュール状態（tokenClient 等）を持つため、各テストで vi.resetModules +
// 動的 import して独立させる。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type GsiCallback = (resp: {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}) => void;
type GsiErrorCallback = (err: { type?: string; message?: string }) => void;

const TOKEN_KEY = "graphium-push-google-token";

let capturedCallback: GsiCallback | null = null;
let capturedErrorCallback: GsiErrorCallback | null = null;
const requestAccessToken = vi.fn();
const initTokenClient = vi.fn(
  (config: { client_id: string; scope: string; callback: GsiCallback; error_callback?: GsiErrorCallback }) => {
    capturedCallback = config.callback;
    capturedErrorCallback = config.error_callback ?? null;
    return { requestAccessToken };
  },
);

/** window.google を「ロード済み gsi」としてインストールする。 */
function installGsi() {
  (window as unknown as { google: unknown }).google = {
    accounts: { oauth2: { initTokenClient } },
  };
}

function uninstallGsi() {
  delete (window as unknown as { google?: unknown }).google;
}

async function freshAuth() {
  vi.resetModules();
  return await import("./google-auth");
}

beforeEach(() => {
  localStorage.clear();
  capturedCallback = null;
  capturedErrorCallback = null;
  requestAccessToken.mockClear();
  initTokenClient.mockClear();
  uninstallGsi();
});

afterEach(() => {
  vi.useRealTimers();
  uninstallGsi();
});

describe("prepareGoogleAuth", () => {
  it("rejects with a config error when the client id is empty", async () => {
    const auth = await freshAuth();
    await expect(auth.prepareGoogleAuth("")).rejects.toMatchObject({
      name: "PushConfigError",
    });
  });

  it("initializes the token client with the drive.file scope only", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");
    expect(initTokenClient).toHaveBeenCalledTimes(1);
    const config = initTokenClient.mock.calls[0][0];
    expect(config.client_id).toBe("client-1");
    expect(config.scope).toBe("https://www.googleapis.com/auth/drive.file");
    expect(auth.isAuthPrepared()).toBe(true);
  });

  it("loads the gsi script dynamically when window.google is absent", async () => {
    const auth = await freshAuth();
    const preparing = auth.prepareGoogleAuth("client-1");
    // スクリプトタグが差し込まれる
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    expect(script).not.toBeNull();
    // ロード完了を模す: gsi グローバルを生やしてから onload を発火
    installGsi();
    script!.onload!(new Event("load"));
    await preparing;
    expect(initTokenClient).toHaveBeenCalledTimes(1);
    script!.remove();
  });

  it("is idempotent for the same client id but re-inits when the id changes", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");
    await auth.prepareGoogleAuth("client-1");
    expect(initTokenClient).toHaveBeenCalledTimes(1);
    await auth.prepareGoogleAuth("client-2"); // 自前 client_id へ切替
    expect(initTokenClient).toHaveBeenCalledTimes(2);
  });
});

describe("connectInteractive", () => {
  it("rejects immediately when not prepared (never lazy-loads inside the gesture)", async () => {
    const auth = await freshAuth();
    await expect(auth.connectInteractive()).rejects.toMatchObject({
      name: "PushConfigError",
    });
    expect(requestAccessToken).not.toHaveBeenCalled();
  });

  it("starts the token request synchronously and resolves via the GIS callback", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");

    const promise = auth.connectInteractive();
    // await より前（= ユーザージェスチャの同期区間内）に要求が出ていること
    expect(requestAccessToken).toHaveBeenCalledTimes(1);

    capturedCallback!({ access_token: "tok-abc", expires_in: 3600 });
    await expect(promise).resolves.toBe("tok-abc");
    expect(auth.getValidAccessToken()).toBe("tok-abc");
    // localStorage に永続化される（PWA が殺されても期限内は再利用できる）
    expect(localStorage.getItem(TOKEN_KEY)).toContain("tok-abc");
  });

  it("shares one in-flight request between double taps", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");

    const first = auth.connectInteractive();
    const second = auth.connectInteractive();
    expect(second).toBe(first);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    capturedCallback!({ access_token: "tok", expires_in: 3600 });
    await first;
  });

  it("rejects with an auth error when GIS reports an error response", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");
    const promise = auth.connectInteractive();
    capturedCallback!({ error: "access_denied" });
    await expect(promise).rejects.toMatchObject({ name: "PushAuthError" });
    expect(auth.getValidAccessToken()).toBeNull();
  });

  it("rejects when the popup fails (error_callback, e.g. closed by the user)", async () => {
    installGsi();
    const auth = await freshAuth();
    await auth.prepareGoogleAuth("client-1");
    const promise = auth.connectInteractive();
    capturedErrorCallback!({ type: "popup_closed" });
    await expect(promise).rejects.toMatchObject({ name: "PushAuthError" });
    // 失敗後は次の要求を新規に出せる
    const retry = auth.connectInteractive();
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
    capturedCallback!({ access_token: "tok2", expires_in: 3600 });
    await retry;
  });
});

describe("トークンの期限管理", () => {
  async function connectAndGetToken(auth: Awaited<ReturnType<typeof freshAuth>>) {
    await auth.prepareGoogleAuth("client-1");
    const promise = auth.connectInteractive();
    capturedCallback!({ access_token: "tok-exp", expires_in: 3600 });
    await promise;
  }

  it("reuses a stored token across module reloads while it is valid", async () => {
    installGsi();
    const auth = await freshAuth();
    await connectAndGetToken(auth);
    // 「PWA 再起動」を模す: モジュールを丸ごと読み直しても localStorage から復元できる
    const auth2 = await freshAuth();
    expect(auth2.getValidAccessToken()).toBe("tok-exp");
  });

  it("drops the token at expiry (with a 60s safety margin) and clears storage", async () => {
    installGsi();
    // Date だけを fake する（setTimeout 等は本物のまま — 他のテストインフラを壊さない）
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    const auth = await freshAuth();
    await connectAndGetToken(auth);
    expect(auth.getValidAccessToken()).toBe("tok-exp");

    // 期限 1 時間のうち 59 分 30 秒経過 → 余裕 60 秒を切っているので失効扱い
    vi.setSystemTime(new Date("2026-07-26T12:59:30Z"));
    expect(auth.getValidAccessToken()).toBeNull();
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it("invalidateAccessToken drops the token (used on Drive 401)", async () => {
    installGsi();
    const auth = await freshAuth();
    await connectAndGetToken(auth);
    auth.invalidateAccessToken();
    expect(auth.getValidAccessToken()).toBeNull();
  });

  it("disconnect revokes best-effort and clears the token", async () => {
    installGsi();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const auth = await freshAuth();
      await connectAndGetToken(auth);
      auth.disconnectGoogleAuth();
      expect(auth.getValidAccessToken()).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain("https://oauth2.googleapis.com/revoke");
      expect(url).toContain("tok-exp");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
