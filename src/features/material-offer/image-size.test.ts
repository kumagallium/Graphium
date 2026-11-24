import { describe, expect, it } from "vitest";
import { imageDimensions, safeForPreview } from "./image-size";
import { blockedExtOfName } from "../../lib/blocked-material-exts";

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number): Uint8Array {
  // SOI, APP0（長さ 16）, SOF0（長さ 17: 精度・高さ・幅）
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, ...new Array(10).fill(0)];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof]);
}

describe("imageDimensions / safeForPreview", () => {
  it("PNG・JPEG・GIF の寸法を頭から読む", () => {
    expect(imageDimensions(png(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageDimensions(jpeg(1200, 800))).toEqual({ width: 1200, height: 800 });
    expect(imageDimensions(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 10, 0, 20, 0]))).toEqual({ width: 10, height: 20 });
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it("寸法が巨大な画像・読めない画像は縮小図にしない", () => {
    expect(safeForPreview(png(640, 480))).toBe(true);
    expect(safeForPreview(png(60000, 60000))).toBe(false);
    expect(safeForPreview(png(16000, 16000))).toBe(false);
    expect(safeForPreview(png(4032, 3024))).toBe(true);
    expect(safeForPreview(png(8000, 6000))).toBe(false);
    expect(safeForPreview(new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("blockedExtOfName", () => {
  it("実行ファイルの拡張子とドットだけの名前を見つける", () => {
    expect(blockedExtOfName("run.SH")).toBe("sh");
    expect(blockedExtOfName(".bat")).toBe("bat");
    expect(blockedExtOfName("photo.jpg")).toBeNull();
    expect(blockedExtOfName("README")).toBeNull();
  });
});
