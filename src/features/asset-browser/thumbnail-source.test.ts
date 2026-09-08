import { describe, expect, it, vi } from "vitest";
import { THUMBNAIL_EDGE, thumbnailUrlFor } from "./thumbnail-source";
import type { StorageProvider } from "../../lib/storage/types";

function provider(overrides: Partial<StorageProvider>): StorageProvider {
  return {
    getMediaBlobUrl: vi.fn(async () => "blob:full"),
    ...overrides,
  } as unknown as StorageProvider;
}

describe("thumbnailUrlFor", () => {
  it("縮小版を持つプロバイダでは縮小版を使う（原寸は読まない）", async () => {
    const p = provider({ getMediaThumbnailUrl: vi.fn(async () => "blob:thumb") });
    await expect(thumbnailUrlFor(p, "f1", "image/png")).resolves.toBe("blob:thumb");
    expect(p.getMediaThumbnailUrl).toHaveBeenCalledWith("f1", THUMBNAIL_EDGE);
    expect(p.getMediaBlobUrl).not.toHaveBeenCalled();
  });

  it("縮小版が作れない（画像として読めない等）ときは原寸に落ち、MIME のヒントを渡す", async () => {
    const p = provider({ getMediaThumbnailUrl: vi.fn(async () => { throw new Error("not an image"); }) });
    await expect(thumbnailUrlFor(p, "f1", "image/svg+xml")).resolves.toBe("blob:full");
    expect(p.getMediaBlobUrl).toHaveBeenCalledWith("f1", "image/svg+xml");
  });

  it("縮小版を持たないプロバイダでは最初から原寸", async () => {
    const p = provider({});
    await expect(thumbnailUrlFor(p, "f1")).resolves.toBe("blob:full");
    expect(p.getMediaBlobUrl).toHaveBeenCalledWith("f1", undefined);
  });
});
