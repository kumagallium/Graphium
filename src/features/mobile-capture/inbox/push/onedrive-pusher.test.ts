// @vitest-environment jsdom
// OneDrivePusher のテスト。onedrive-auth と fetch はモック。
//
// 対象の不変条件:
// - client ID（GUID）が無ければ isConfigured()=false で prepare は PushConfigError
// - createUploadSession → uploadUrl へ 320 KiB の倍数の断片で PUT（Content-Range 付き）
// - **uploadUrl への PUT に Authorization を付けない**（Graph の呼び出しには付ける）
// - 0 バイトは分割せず単純 PUT
// - Graph の 401 は鍵を捨てて 1 回だけ取り直して再試行、それでも 401 なら PushAuthError
// - Inbox が無い（404）ときは作って 1 回だけ再試行
// - 名前は encodeURIComponent してパスに入れる

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMock = vi.hoisted(() => ({
  getValidAccessToken: vi.fn<() => Promise<string | null>>(async () => "tok-1"),
  invalidateAccessToken: vi.fn(),
  prepareOneDriveAuth: vi.fn(async (_clientId: string) => {}),
  connectInteractive: vi.fn(async () => {}),
  disconnectOneDriveAuth: vi.fn(),
  hasLinkedBefore: vi.fn<() => boolean>(() => true),
  getRefreshRemainingMs: vi.fn<() => number | null>(() => 3_600_000),
  isOneDriveAuthPrepared: vi.fn<() => boolean>(() => true),
  isConnected: vi.fn<() => boolean>(() => true),
}));
vi.mock("./onedrive-auth", () => authMock);

// 同梱の client ID の有無に左右されないよう、解決だけ差し替える
const configMock = vi.hoisted(() => ({
  getOneDriveClientId: vi.fn<() => string | null>(() => null),
}));
vi.mock("./config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config")>()),
  getOneDriveClientId: configMock.getOneDriveClientId,
}));

import { OneDrivePusher } from "./onedrive-pusher";
import { PushAuthError, PushConfigError } from "./types";

const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const UNIT = 320 * 1024;
const APPROOT = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const UPLOAD_URL = "https://upload.example.test/session/abc";

type FetchCall = { url: string; init: RequestInit | undefined };

function installFetchQueue(responses: Array<Response | ((call: FetchCall) => Response)>) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: FetchCall = { url: String(input), init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected fetch: ${call.url}`);
    return typeof next === "function" ? next(call) : next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFile(bytes: number, name = "graphium-20260101-000000-01.jpg"): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
}

function headerOf(call: FetchCall, name: string): string | undefined {
  const h = call.init?.headers as Record<string, string> | undefined;
  if (!h) return undefined;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
}

beforeEach(() => {
  localStorage.clear();
  configMock.getOneDriveClientId.mockReset().mockReturnValue(CLIENT_ID);
  authMock.getValidAccessToken.mockReset().mockResolvedValue("tok-1");
  authMock.invalidateAccessToken.mockReset();
  authMock.prepareOneDriveAuth.mockReset().mockResolvedValue(undefined);
  authMock.connectInteractive.mockReset().mockResolvedValue(undefined);
  authMock.disconnectOneDriveAuth.mockReset();
  authMock.hasLinkedBefore.mockReset().mockReturnValue(true);
  authMock.getRefreshRemainingMs.mockReset().mockReturnValue(3_600_000);
  authMock.isOneDriveAuthPrepared.mockReset().mockReturnValue(true);
  authMock.isConnected.mockReset().mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("設定と接続状態", () => {
  it("is configured only when a GUID client ID exists", async () => {
    const pusher = new OneDrivePusher();
    expect(pusher.kind).toBe("onedrive");
    expect(pusher.isConfigured()).toBe(true);
    await pusher.prepare();
    expect(authMock.prepareOneDriveAuth).toHaveBeenCalledWith(CLIENT_ID);

    configMock.getOneDriveClientId.mockReturnValue(null);
    expect(pusher.isConfigured()).toBe(false);
    await expect(pusher.prepare()).rejects.toBeInstanceOf(PushConfigError);
  });

  it("delegates prepared / connected / linked / disconnect to the auth layer", () => {
    const pusher = new OneDrivePusher();
    authMock.isOneDriveAuthPrepared.mockReturnValue(false);
    authMock.isConnected.mockReturnValue(false);
    authMock.hasLinkedBefore.mockReturnValue(false);
    expect(pusher.isPrepared()).toBe(false);
    expect(pusher.isConnected()).toBe(false);
    expect(pusher.hasLinkedBefore()).toBe(false);
    pusher.disconnect();
    expect(authMock.disconnectOneDriveAuth).toHaveBeenCalledTimes(1);
  });

  it("connect() reaches the auth layer synchronously", () => {
    const pusher = new OneDrivePusher();
    void pusher.connect();
    expect(authMock.connectInteractive).toHaveBeenCalledTimes(1);
  });

  it("needsRenewal: only when configured, linked before, and the key is missing or under 10 minutes", () => {
    const pusher = new OneDrivePusher();
    authMock.getRefreshRemainingMs.mockReturnValue(3_600_000);
    expect(pusher.needsRenewal()).toBe(false);
    authMock.getRefreshRemainingMs.mockReturnValue(9 * 60 * 1000);
    expect(pusher.needsRenewal()).toBe(true);
    authMock.getRefreshRemainingMs.mockReturnValue(null);
    expect(pusher.needsRenewal()).toBe(true);
    authMock.hasLinkedBefore.mockReturnValue(false);
    expect(pusher.needsRenewal()).toBe(false);
    authMock.hasLinkedBefore.mockReturnValue(true);
    configMock.getOneDriveClientId.mockReturnValue(null);
    expect(pusher.needsRenewal()).toBe(false);
  });

  it("refuses a chunk size that is not a multiple of 320 KiB", () => {
    expect(() => new OneDrivePusher({ chunkBytes: 1024 * 1024 })).toThrow(/320 KiB/);
  });
});

describe("アップロード", () => {
  it("does not send the file to an upload URL that is not https", async () => {
    const { calls } = installFetchQueue([json({ uploadUrl: "http://example.test/upload" })]);
    await expect(new OneDrivePusher().push(makeFile(1024))).rejects.toThrow(/unexpected upload URL/);
    // セッション作成の 1 回だけ。中身の PUT は出ていない
    expect(calls).toHaveLength(1);
  });

  it("uploads in 320 KiB-multiple fragments without Authorization on uploadUrl", async () => {
    // 既定の断片は 10 MiB。25 MiB なら 10 + 10 + 5 MiB の 3 回
    const size = 25 * 1024 * 1024;
    const { calls } = installFetchQueue([
      json({ uploadUrl: UPLOAD_URL }),
      json({ nextExpectedRanges: ["10485760-"] }, 202),
      json({ nextExpectedRanges: ["20971520-"] }, 202),
      json({ id: "item-1", name: "graphium-20260101-000000-01.jpg" }, 201),
    ]);
    const progress: number[] = [];
    const result = await new OneDrivePusher().push(makeFile(size), {
      onProgress: (p) => progress.push(p.sentBytes),
    });

    expect(result).toEqual({ fileId: "item-1", name: "graphium-20260101-000000-01.jpg" });
    expect(calls).toHaveLength(4);

    // セッション作成: Graph なので Authorization 付き・rename・名前はエンコード済み
    expect(calls[0].url).toBe(
      `${APPROOT}:/Inbox/graphium-20260101-000000-01.jpg:/createUploadSession`,
    );
    expect(calls[0].init?.method).toBe("POST");
    expect(headerOf(calls[0], "Authorization")).toBe("Bearer tok-1");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      item: { "@microsoft.graph.conflictBehavior": "rename" },
    });

    // 断片: uploadUrl へ。Authorization は付けない
    const chunks = calls.slice(1);
    for (const c of chunks) {
      expect(c.url).toBe(UPLOAD_URL);
      expect(c.init?.method).toBe("PUT");
      expect(headerOf(c, "Authorization")).toBeUndefined();
    }
    const ranges = chunks.map((c) => /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headerOf(c, "Content-Range") ?? ""));
    expect(ranges.every((m) => m !== null)).toBe(true);
    const parsed = ranges.map((m) => ({ start: Number(m![1]), end: Number(m![2]), total: Number(m![3]) }));
    expect(parsed.map((r) => r.total)).toEqual([size, size, size]);
    // 最後以外の断片は 320 KiB の倍数、始点も倍数
    for (const r of parsed.slice(0, -1)) {
      expect((r.end - r.start + 1) % UNIT).toBe(0);
    }
    for (const r of parsed) expect(r.start % UNIT).toBe(0);
    expect(parsed[parsed.length - 1].end).toBe(size - 1);
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(size);
  });

  it("encodes the file name in the item path", async () => {
    const { calls } = installFetchQueue([
      json({ uploadUrl: UPLOAD_URL }),
      json({ id: "i", name: "a b#c.jpg" }, 201),
    ]);
    await new OneDrivePusher().push(makeFile(10, "a b#c.jpg"));
    expect(calls[0].url).toBe(`${APPROOT}:/Inbox/a%20b%23c.jpg:/createUploadSession`);
  });

  it("returns the name OneDrive finally used (rename on conflict)", async () => {
    installFetchQueue([json({ uploadUrl: UPLOAD_URL }), json({ id: "i", name: "photo 1.jpg" }, 200)]);
    const result = await new OneDrivePusher().push(makeFile(10, "photo.jpg"));
    expect(result).toEqual({ fileId: "i", name: "photo 1.jpg" });
  });

  it("uses a simple PUT for a zero-byte file", async () => {
    const { calls } = installFetchQueue([json({ id: "empty-1", name: "empty.txt" }, 201)]);
    const result = await new OneDrivePusher().push(makeFile(0, "empty.txt"));
    expect(result.fileId).toBe("empty-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      `${APPROOT}:/Inbox/empty.txt:/content?@microsoft.graph.conflictBehavior=rename`,
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(headerOf(calls[0], "Authorization")).toBe("Bearer tok-1");
    expect(calls.some((c) => c.url.includes("createUploadSession"))).toBe(false);
  });

  it("fails (for the queue to retry) when a chunk is rejected", async () => {
    installFetchQueue([json({ uploadUrl: UPLOAD_URL }), json({}, 500)]);
    await expect(new OneDrivePusher().push(makeFile(100))).rejects.toThrow(/500/);
  });

  it("fails instead of looping when the server reports no progress", async () => {
    installFetchQueue([
      json({ uploadUrl: UPLOAD_URL }),
      json({ nextExpectedRanges: ["0-"] }, 202),
    ]);
    const pusher = new OneDrivePusher({ chunkBytes: UNIT });
    await expect(pusher.push(makeFile(UNIT * 2))).rejects.toThrow(/no progress/);
  });
});

describe("認証と Inbox の保険", () => {
  it("throws PushAuthError when no key can be obtained", async () => {
    authMock.getValidAccessToken.mockResolvedValue(null);
    const { fetchMock } = installFetchQueue([]);
    await expect(new OneDrivePusher().push(makeFile(10))).rejects.toBeInstanceOf(PushAuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a Graph 401 exactly once with a fresh token", async () => {
    authMock.getValidAccessToken.mockResolvedValueOnce("tok-old").mockResolvedValueOnce("tok-new");
    const { calls } = installFetchQueue([
      json({ error: {} }, 401),
      json({ uploadUrl: UPLOAD_URL }),
      json({ id: "i", name: "n.jpg" }, 201),
    ]);
    const result = await new OneDrivePusher().push(makeFile(10, "n.jpg"));
    expect(result.fileId).toBe("i");
    expect(authMock.invalidateAccessToken).toHaveBeenCalledTimes(1);
    expect(headerOf(calls[0], "Authorization")).toBe("Bearer tok-old");
    expect(headerOf(calls[1], "Authorization")).toBe("Bearer tok-new");
  });

  it("throws PushAuthError when the retry is also 401", async () => {
    authMock.getValidAccessToken.mockResolvedValueOnce("tok-old").mockResolvedValueOnce("tok-new");
    const { calls } = installFetchQueue([json({}, 401), json({}, 401)]);
    await expect(new OneDrivePusher().push(makeFile(10))).rejects.toBeInstanceOf(PushAuthError);
    expect(calls).toHaveLength(2);
    expect(authMock.invalidateAccessToken).toHaveBeenCalledTimes(2);
  });

  it("throws PushAuthError when no fresh token can be obtained after a 401", async () => {
    authMock.getValidAccessToken.mockResolvedValueOnce("tok-old").mockResolvedValueOnce(null);
    installFetchQueue([json({}, 401)]);
    await expect(new OneDrivePusher().push(makeFile(10))).rejects.toBeInstanceOf(PushAuthError);
  });

  it("creates Inbox under approot on 404 and retries once", async () => {
    const { calls } = installFetchQueue([
      json({ error: { code: "itemNotFound" } }, 404),
      json({ id: "folder-1" }, 201),
      json({ uploadUrl: UPLOAD_URL }),
      json({ id: "i", name: "n.jpg" }, 201),
    ]);
    const result = await new OneDrivePusher().push(makeFile(10, "n.jpg"));
    expect(result.fileId).toBe("i");
    expect(calls[1].url).toBe(`${APPROOT}/children`);
    expect(calls[1].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1].init?.body)).name).toBe("Inbox");
    expect(calls[2].url).toContain("createUploadSession");
  });

  it("gives up after the one retry when Inbox is still missing", async () => {
    const { calls } = installFetchQueue([json({}, 404), json({ id: "f" }, 201), json({}, 404)]);
    await expect(new OneDrivePusher().push(makeFile(10))).rejects.toThrow();
    expect(calls).toHaveLength(3);
  });

  it("treats 409 on folder creation as success (it already exists)", async () => {
    installFetchQueue([
      json({}, 404),
      json({ error: { code: "nameAlreadyExists" } }, 409),
      json({ uploadUrl: UPLOAD_URL }),
      json({ id: "i", name: "n.jpg" }, 201),
    ]);
    await expect(new OneDrivePusher().push(makeFile(10, "n.jpg"))).resolves.toMatchObject({ fileId: "i" });
  });
});
