// 捕獲サムネイル生成のテスト。
//
// 実物の画像デコードは環境依存（node には canvas が無い）なので、
// createImageBitmap / OffscreenCanvas / DOM canvas を最小のフェイクで差し替え、
// **サムネが無くても壊れない**という不変条件を中心に見る:
// - 画像でない・大きすぎるものは焼かない（null）
// - canvas が無い環境でも例外を投げず null
// - 長辺 200px に縮小し JPEG で焼く（縦横比は保つ）
// - OffscreenCanvas が使えない環境では DOM canvas 経路に落ちる

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  THUMBNAIL_MAX_EDGE,
  THUMBNAIL_SOURCE_MAX_BYTES,
  createCaptureThumbnail,
} from "./thumbnail";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** createImageBitmap + OffscreenCanvas を差し替え、生成された canvas 寸法を記録する。 */
function stubOffscreen(bitmap: { width: number; height: number }): Array<[number, number]> {
  const sizes: Array<[number, number]> = [];
  vi.stubGlobal("createImageBitmap", async () => ({ ...bitmap, close: () => {} }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        sizes.push([width, height]);
      }
      getContext() {
        return { drawImage: () => {} };
      }
      async convertToBlob(opts: { type: string; quality: number }) {
        return new Blob([`q=${opts.quality}`], { type: opts.type });
      }
    },
  );
  return sizes;
}

describe("createCaptureThumbnail", () => {
  it("returns null for anything that is not an image", async () => {
    stubOffscreen({ width: 100, height: 100 });
    const video = new Blob(["clip"], { type: "video/quicktime" });
    expect(await createCaptureThumbnail(video)).toBeNull();
    // 動画のフレーム抽出はしない（種別アイコンで足りる）
  });

  it("returns null for an image beyond the source size cap", async () => {
    stubOffscreen({ width: 100, height: 100 });
    const huge = {
      type: "image/jpeg",
      size: THUMBNAIL_SOURCE_MAX_BYTES + 1,
    } as Blob;
    expect(await createCaptureThumbnail(huge)).toBeNull();
  });

  it("returns null instead of throwing where no canvas exists (node / locked-down WebView)", async () => {
    expect(await createCaptureThumbnail(new Blob(["x"], { type: "image/jpeg" }))).toBeNull();
  });

  it("downscales the long edge to 200px as JPEG, keeping the aspect ratio", async () => {
    const sizes = stubOffscreen({ width: 4000, height: 3000 });

    const thumb = await createCaptureThumbnail(new Blob(["x"], { type: "image/jpeg" }));

    expect(sizes).toEqual([[THUMBNAIL_MAX_EDGE, 150]]);
    expect(thumb?.type).toBe("image/jpeg");
    expect(await thumb!.text()).toBe("q=0.7");
  });

  it("does not upscale an image that is already small", async () => {
    const sizes = stubOffscreen({ width: 80, height: 60 });
    await createCaptureThumbnail(new Blob(["x"], { type: "image/jpeg" }));
    expect(sizes).toEqual([[80, 60]]);
  });

  it("falls back to null (icon) when the decode itself fails", async () => {
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("decode failed");
    });
    vi.stubGlobal("OffscreenCanvas", class {});
    expect(await createCaptureThumbnail(new Blob(["x"], { type: "image/jpeg" }))).toBeNull();
  });
});
