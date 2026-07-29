import { describe, it, expect, afterEach, vi } from "vitest";
import { remoteImageFileName, fetchRemoteImageAsFile, saveRemoteImageAsMedia } from "./remote-image";

// 画像バイトの取得は globalThis.fetch を spy して差し替える（url.test.ts と同じ方式）。
function mockImageResponse(bytes: string, contentType: string, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(status === 200 ? bytes : null, {
      status,
      headers: status === 200 ? { "content-type": contentType } : {},
    }) as Response,
  );
}

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
    );
    expect(file.name).toBe("lead.png");
    expect(file.type).toBe("image/png");
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
