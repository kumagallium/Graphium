// @vitest-environment jsdom
// GoogleDrivePusher のテスト。google-auth と fetch はモック。
//
// 対象の不変条件:
// - client_id 未設定なら isConfigured()=false（UI が設定案内を出す前提）
// - フォルダ解決は Graphium → Inbox の find-or-create で、結果をキャッシュして
//   2 回目以降はフォルダクエリを打たない
// - ≤閾値は multipart、超えたら resumable に振り分ける
// - resumable は Location が読めなければ X-GUploader-UploadID からセッション URI を再構成
// - キャッシュ済みフォルダ起因の 404/403 はキャッシュ破棄 → 作り直して 1 回だけ再試行
// - 401 は invalidateAccessToken + PushAuthError（queue の中断シグナル）

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// google-auth をモック（vi.hoisted パターンは transport.test.ts と同じ）
const authMock = vi.hoisted(() => ({
  getValidAccessToken: vi.fn<() => string | null>(() => "tok-1"),
  invalidateAccessToken: vi.fn(),
  prepareGoogleAuth: vi.fn(async (_clientId: string) => {}),
  connectInteractive: vi.fn(async () => "tok-1"),
  disconnectGoogleAuth: vi.fn(),
}));
vi.mock("./google-auth", () => authMock);

import { GoogleDrivePusher } from "./drive-pusher";
import { getDriveFolderCache, setDriveFolderCache, setGoogleClientIdOverride } from "./config";

type FetchCall = { url: string; init: RequestInit | undefined };

/** 応答キューを順番に返す fetch モック。呼び出しの記録付き。 */
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

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeFile(bytes: number, name = "photo.jpg", type = "image/jpeg"): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

beforeEach(() => {
  localStorage.clear();
  authMock.getValidAccessToken.mockReset().mockReturnValue("tok-1");
  authMock.invalidateAccessToken.mockReset();
  authMock.prepareGoogleAuth.mockReset().mockResolvedValue(undefined);
  authMock.connectInteractive.mockReset().mockResolvedValue("tok-1");
  authMock.disconnectGoogleAuth.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("設定と接続状態", () => {
  it("isConfigured is false without a client id (bundled default is a placeholder)", () => {
    const pusher = new GoogleDrivePusher();
    expect(pusher.isConfigured()).toBe(false);
  });

  it("isConfigured becomes true with a localStorage override, and prepare passes it through", async () => {
    setGoogleClientIdOverride("my-id");
    const pusher = new GoogleDrivePusher();
    expect(pusher.isConfigured()).toBe(true);
    await pusher.prepare();
    expect(authMock.prepareGoogleAuth).toHaveBeenCalledWith("my-id");
  });

  it("prepare rejects with a config error when unconfigured", async () => {
    const pusher = new GoogleDrivePusher();
    await expect(pusher.prepare()).rejects.toMatchObject({ name: "PushConfigError" });
    expect(authMock.prepareGoogleAuth).not.toHaveBeenCalled();
  });

  it("isConnected mirrors token validity and push fails fast without a token", async () => {
    const pusher = new GoogleDrivePusher();
    expect(pusher.isConnected()).toBe(true);
    authMock.getValidAccessToken.mockReturnValue(null);
    expect(pusher.isConnected()).toBe(false);
    await expect(pusher.push(makeFile(3))).rejects.toMatchObject({ name: "PushAuthError" });
  });

  it("disconnect clears the auth and the folder cache (account may change)", () => {
    setDriveFolderCache({ rootId: "r", inboxId: "i" });
    new GoogleDrivePusher().disconnect();
    expect(authMock.disconnectGoogleAuth).toHaveBeenCalled();
    expect(getDriveFolderCache()).toBeNull();
  });
});

describe("multipart アップロード（≤5MB 相当）", () => {
  it("resolves Graphium/Inbox via find-or-create, uploads multipart, caches folder ids", async () => {
    const { calls } = installFetchQueue([
      json({ files: [{ id: "root-1" }] }), // Graphium 検索 → 既存
      json({ files: [] }), // Inbox 検索 → 無い
      json({ id: "inbox-1" }), // Inbox 作成
      json({ id: "file-1" }), // multipart アップロード
    ]);
    const pusher = new GoogleDrivePusher();
    const file = makeFile(10, "graphium-20260726-120000-01.jpg");
    const progress: number[] = [];
    const result = await pusher.push(file, {
      onProgress: (p) => progress.push(p.sentBytes),
    });

    expect(result).toEqual({ fileId: "file-1", name: "graphium-20260726-120000-01.jpg" });
    // クエリの中身: Graphium はフォルダ MIME + trashed=false、Inbox は親付き
    expect(decodeURIComponent(calls[0].url)).toContain("name='Graphium'");
    expect(decodeURIComponent(calls[1].url)).toContain("'root-1' in parents");
    // 作成リクエストは親 root-1 のフォルダ
    expect(JSON.parse(String(calls[2].init?.body))).toMatchObject({
      name: "Inbox",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-1"],
    });
    // multipart 本体: uploadType=multipart、FormData に metadata + file
    expect(calls[3].url).toContain("uploadType=multipart");
    const form = calls[3].init?.body as FormData;
    const metadata = JSON.parse(await (form.get("metadata") as Blob).text());
    expect(metadata).toEqual({ name: "graphium-20260726-120000-01.jpg", parents: ["inbox-1"] });
    expect((form.get("file") as File).size).toBe(10);
    // Authorization ヘッダ
    expect((calls[3].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok-1");
    // 進捗は開始/完了の 2 点
    expect(progress).toEqual([0, 10]);
    // フォルダ ID がキャッシュされる
    expect(getDriveFolderCache()).toEqual({ rootId: "root-1", inboxId: "inbox-1" });
  });

  it("skips folder queries entirely when the cache is warm", async () => {
    setDriveFolderCache({ rootId: "root-1", inboxId: "inbox-1" });
    const { calls } = installFetchQueue([json({ id: "file-2" })]);
    const result = await new GoogleDrivePusher().push(makeFile(4));
    expect(result.fileId).toBe("file-2");
    expect(calls).toHaveLength(1); // multipart の 1 リクエストのみ
  });

  it("drops a stale folder cache on 404, re-ensures the folders, and retries once", async () => {
    setDriveFolderCache({ rootId: "root-old", inboxId: "inbox-old" });
    const { calls } = installFetchQueue([
      new Response("not found", { status: 404 }), // 旧 inbox 宛の multipart → 404
      json({ files: [{ id: "root-new" }] }), // 再解決: Graphium
      json({ files: [{ id: "inbox-new" }] }), // 再解決: Inbox
      json({ id: "file-3" }), // 再アップロード成功
    ]);
    const result = await new GoogleDrivePusher().push(makeFile(4));
    expect(result.fileId).toBe("file-3");
    expect(calls).toHaveLength(4);
    expect(getDriveFolderCache()).toEqual({ rootId: "root-new", inboxId: "inbox-new" });
  });

  it("maps 401 to PushAuthError and invalidates the local token", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "i" });
    installFetchQueue([new Response("unauthorized", { status: 401 })]);
    await expect(new GoogleDrivePusher().push(makeFile(4))).rejects.toMatchObject({
      name: "PushAuthError",
    });
    expect(authMock.invalidateAccessToken).toHaveBeenCalled();
  });
});

describe("resumable アップロード（>5MB 相当）", () => {
  // テストでは閾値とチャンクを小さくして振り分けとチャンク分割の数学だけを検証する
  // （本番値: 閾値 5MB / チャンク 8MiB = 256KiB の倍数）
  const smallPusher = () =>
    new GoogleDrivePusher({ multipartLimitBytes: 8, chunkBytes: 4 });

  it("switches to resumable above the limit and uploads in Content-Range chunks", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "inbox-1" });
    const { calls } = installFetchQueue([
      new Response(null, {
        status: 200,
        headers: { Location: "https://upload.example/session-1" },
      }),
      new Response(null, { status: 308, headers: { Range: "bytes=0-3" } }),
      new Response(null, { status: 308, headers: { Range: "bytes=0-7" } }),
      json({ id: "big-1" }),
    ]);
    const file = makeFile(10, "graphium-20260726-120000-01.mov", "video/quicktime");
    const progress: number[] = [];
    const result = await smallPusher().push(file, {
      onProgress: (p) => progress.push(p.sentBytes),
    });

    expect(result.fileId).toBe("big-1");
    // 初期化リクエスト: メタデータ + X-Upload-Content-* ヘッダ
    expect(calls[0].url).toContain("uploadType=resumable");
    const initHeaders = calls[0].init?.headers as Record<string, string>;
    expect(initHeaders["X-Upload-Content-Type"]).toBe("video/quicktime");
    expect(initHeaders["X-Upload-Content-Length"]).toBe("10");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      name: "graphium-20260726-120000-01.mov",
      parents: ["inbox-1"],
    });
    // チャンクはセッション URI へ、Content-Range 付きで直列に
    expect(calls.slice(1).map((c) => c.url)).toEqual([
      "https://upload.example/session-1",
      "https://upload.example/session-1",
      "https://upload.example/session-1",
    ]);
    expect(
      calls.slice(1).map((c) => (c.init?.headers as Record<string, string>)["Content-Range"]),
    ).toEqual(["bytes 0-3/10", "bytes 4-7/10", "bytes 8-9/10"]);
    expect(progress).toEqual([0, 4, 8, 10]);
  });

  it("reconstructs the session URI from X-GUploader-UploadID when Location is unreadable (CORS)", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "inbox-1" });
    const { calls } = installFetchQueue([
      new Response(null, {
        status: 200,
        headers: { "X-GUploader-UploadID": "upload-id-42" },
      }),
      json({ id: "big-2" }), // 1 チャンクで完了
    ]);
    const result = await smallPusher().push(makeFile(9));
    expect(result.fileId).toBe("big-2");
    expect(calls[1].url).toBe(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=upload-id-42&fields=id",
    );
  });

  it("fails clearly when neither Location nor X-GUploader-UploadID is available", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "inbox-1" });
    installFetchQueue([new Response(null, { status: 200 })]);
    await expect(smallPusher().push(makeFile(9))).rejects.toThrow(
      /session URI is unavailable/,
    );
  });

  it("aborts the attempt when the server confirms no progress (no infinite chunk loop)", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "inbox-1" });
    installFetchQueue([
      new Response(null, { status: 200, headers: { Location: "https://upload.example/s" } }),
      new Response(null, { status: 308 }), // Range 無し = 何も受信されていない
    ]);
    await expect(smallPusher().push(makeFile(9))).rejects.toThrow(/no progress/);
  });

  it("maps 401 during a chunk to PushAuthError (token expired mid-upload)", async () => {
    setDriveFolderCache({ rootId: "r", inboxId: "inbox-1" });
    installFetchQueue([
      new Response(null, { status: 200, headers: { Location: "https://upload.example/s" } }),
      new Response(null, { status: 308, headers: { Range: "bytes=0-3" } }),
      new Response("unauthorized", { status: 401 }),
    ]);
    await expect(smallPusher().push(makeFile(9))).rejects.toMatchObject({
      name: "PushAuthError",
    });
    expect(authMock.invalidateAccessToken).toHaveBeenCalled();
  });
});
