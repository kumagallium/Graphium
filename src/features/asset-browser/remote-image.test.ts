import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  remoteImageFileName,
  fetchRemoteImageAsFile,
  saveRemoteImageAsMedia,
  saveDataImageAsMedia,
  MAX_REMOTE_IMAGE_BYTES,
} from "./remote-image";

// image-proxy が届くかの判定はストレージ capabilities を見る。実物はモジュール内で
// 結果をキャッシュするので、テストからはモジュールごと差し替えて素性を明示する。
const capabilities = vi.hoisted(() => ({
  value: { serverStorage: true, requiresAuth: false } as
    | { serverStorage: boolean; requiresAuth: boolean }
    | null,
}));
vi.mock("../../lib/storage/providers/server-fs", () => ({
  fetchCapabilities: async () => capabilities.value,
}));

// 画像バイトの取得は globalThis.fetch を spy して差し替える（url.test.ts と同じ方式）。
function mockImageResponse(
  bytes: string,
  contentType: string,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(status === 200 ? bytes : null, {
      status,
      headers: status === 200 ? { "content-type": contentType, ...extraHeaders } : {},
    }) as Response,
  );
}

beforeEach(() => {
  capabilities.value = { serverStorage: true, requiresAuth: false };
});

describe("remoteImageFileName", () => {
  it("URL のベース名と MIME 由来の拡張子で組み立てる", () => {
    expect(remoteImageFileName("https://cdn.example.com/a/hero-shot.jpg", "image/jpeg")).toBe(
      "hero-shot.jpeg",
    );
  });

  it("クエリ付き URL でもパス末尾だけを見る", () => {
    expect(remoteImageFileName("https://cdn.example.com/lead.png?w=1200&s=abc", "image/png")).toBe(
      "lead.png",
    );
  });

  it("image/svg+xml のようなサブタイプは + 以降を落とす", () => {
    expect(remoteImageFileName("https://example.com/logo", "image/svg+xml")).toBe("logo.svg");
  });

  it("URL 解析に失敗しても既定名にフォールバックする", () => {
    expect(remoteImageFileName("not a url", "image/png")).toBe("image.png");
  });

  it("パス末尾が空なら既定名にフォールバックする", () => {
    expect(remoteImageFileName("https://example.com/", "image/webp")).toBe("image.webp");
  });
});

describe("fetchRemoteImageAsFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("image-proxy 経由で取得し、MIME と名前を持つ File を返す", async () => {
    const spy = mockImageResponse("PNGBYTES", "image/png");
    const file = await fetchRemoteImageAsFile("https://cdn.example.com/lead.png");
    expect(spy).toHaveBeenCalledWith(
      "/api/url/image-proxy?url=" + encodeURIComponent("https://cdn.example.com/lead.png"),
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(file.name).toBe("lead.png");
    expect(file.type).toBe("image/png");
  });

  it("応答が返らないままにならないよう、必ずタイムアウトを付ける", async () => {
    const spy = mockImageResponse("PNGBYTES", "image/png");
    await fetchRemoteImageAsFile("https://cdn.example.com/lead.png");
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("image-proxy が届かない環境では要求そのものを出さない", async () => {
    // web の静的配信（sidecar 無し）。配信元へ直接取りに行くフォールバックはしない
    capabilities.value = { serverStorage: false, requiresAuth: false };
    const spy = mockImageResponse("PNGBYTES", "image/png");
    await expect(fetchRemoteImageAsFile("https://cdn.example.com/lead.png")).rejects.toThrow(
      "image-proxy unavailable",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("content-length が上限を超えていたら本文を読まずに throw する", async () => {
    mockImageResponse("PNGBYTES", "image/png", 200, {
      "content-length": String(MAX_REMOTE_IMAGE_BYTES + 1),
    });
    await expect(fetchRemoteImageAsFile("https://cdn.example.com/lead.png")).rejects.toThrow(
      "image too large",
    );
  });

  it("content-length を申告しない相手でも、届いたバイト数で弾く", async () => {
    // sidecar は content-length しか見られないので、chunked はここでしか止まらない
    const big = "x".repeat(64);
    mockImageResponse(big, "image/png");
    vi.spyOn(Blob.prototype, "size", "get").mockReturnValue(MAX_REMOTE_IMAGE_BYTES + 1);
    await expect(fetchRemoteImageAsFile("https://cdn.example.com/lead.png")).rejects.toThrow(
      "image too large",
    );
  });

  it("proxy がエラーを返したら throw する", async () => {
    mockImageResponse("", "application/json", 502);
    await expect(fetchRemoteImageAsFile("https://cdn.example.com/lead.png")).rejects.toThrow(
      "image-proxy 502",
    );
  });

  it("画像でない content-type は throw する（HTML エラーページ等）", async () => {
    mockImageResponse("<html>nope</html>", "text/html");
    await expect(fetchRemoteImageAsFile("https://cdn.example.com/lead.png")).rejects.toThrow(
      "not an image",
    );
  });
});

describe("saveRemoteImageAsMedia", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("保存に成功したらローカル URL と保存名を返す", async () => {
    mockImageResponse("PNGBYTES", "image/png");
    const uploaded: File[] = [];
    const result = await saveRemoteImageAsMedia("https://cdn.example.com/lead.png", async (f) => {
      uploaded.push(f);
      return "local://media/abc123";
    });
    expect(result).toEqual({ url: "local://media/abc123", name: "lead.png" });
    expect(uploaded).toHaveLength(1);
  });

  it("取得に失敗したら null を返す（リモート URL へフォールバックしない）", async () => {
    mockImageResponse("", "application/json", 502);
    const result = await saveRemoteImageAsMedia("https://cdn.example.com/lead.png", async () => {
      throw new Error("upload should not be reached");
    });
    expect(result).toBeNull();
  });

  it("アップロードに失敗しても null を返す", async () => {
    mockImageResponse("PNGBYTES", "image/png");
    const result = await saveRemoteImageAsMedia("https://cdn.example.com/lead.png", async () => {
      throw new Error("drive unavailable");
    });
    expect(result).toBeNull();
  });
});

describe("saveDataImageAsMedia", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("base64 の data URL を File に組み直して保存する", async () => {
    // "PNG" の base64。名前は MIME だけから作る（base64 本体が名前に混ざらないこと）
    const uploaded: File[] = [];
    const result = await saveDataImageAsMedia("data:image/jpeg;base64,UE5H", async (f) => {
      uploaded.push(f);
      return "local-media://from-data";
    });
    expect(result).toEqual({ url: "local-media://from-data", name: "image.jpeg" });
    expect(uploaded[0].type).toBe("image/jpeg");
    expect(await uploaded[0].text()).toBe("PNG");
  });

  it("パーセントエンコードの data URL（svg 等）も読める", async () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg'/>";
    const uploaded: File[] = [];
    const result = await saveDataImageAsMedia(
      `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
      async (f) => {
        uploaded.push(f);
        return "local-media://from-svg";
      },
    );
    expect(result?.name).toBe("image.svg");
    expect(await uploaded[0].text()).toBe(svg);
  });

  it("要求を出さない（data URL の中身は既に手元にある）", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    await saveDataImageAsMedia("data:image/png;base64,UE5H", async () => "local-media://x");
    expect(spy).not.toHaveBeenCalled();
  });

  it("画像でない data URL は保存しない", async () => {
    const upload = vi.fn(async () => "unreached");
    expect(await saveDataImageAsMedia("data:text/html;base64,UE5H", upload)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("本文が壊れている / 空の data URL は保存しない", async () => {
    const upload = vi.fn(async () => "unreached");
    // base64 として読めない
    expect(await saveDataImageAsMedia("data:image/png;base64,!!!", upload)).toBeNull();
    // 中身が無い（画像として開けないゴミを素材にしない）
    expect(await saveDataImageAsMedia("data:image/png;base64,", upload)).toBeNull();
    // カンマが無い＝ data URL の形になっていない
    expect(await saveDataImageAsMedia("data:image/png", upload)).toBeNull();
    expect(upload).not.toHaveBeenCalled();
  });

  it("アップロードに失敗しても null を返す", async () => {
    const result = await saveDataImageAsMedia("data:image/png;base64,UE5H", async () => {
      throw new Error("drive unavailable");
    });
    expect(result).toBeNull();
  });
});
