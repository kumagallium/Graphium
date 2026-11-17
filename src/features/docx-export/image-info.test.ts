// image-info.ts（画像ヘッダから縦横を読む）のユニットテスト

import { describe, it, expect } from "vitest";
import { readImageInfo } from "./image-info";

const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];
const le32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

const png = (w: number, h: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(w), ...be32(h), 8, 6, 0, 0, 0]);
const gif = (w: number, h: number) =>
  new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(w), ...le16(h), 0, 0, 0]);
const bmp = (w: number, h: number) =>
  new Uint8Array([0x42, 0x4d, ...le32(54), 0, 0, 0, 0, ...le32(54), ...le32(40), ...le32(w), ...le32(h), 1, 0, 24, 0]);
// SOI → APP0（長さ 16）→ SOF0（精度・高さ・幅）
const jpeg = (w: number, h: number) =>
  new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ]);

describe("readImageInfo", () => {
  it("PNG", () => expect(readImageInfo(png(320, 200))).toEqual({ type: "png", width: 320, height: 200 }));
  it("JPEG", () => expect(readImageInfo(jpeg(640, 480))).toEqual({ type: "jpg", width: 640, height: 480 }));
  it("GIF", () => expect(readImageInfo(gif(16, 9))).toEqual({ type: "gif", width: 16, height: 9 }));
  it("BMP", () => expect(readImageInfo(bmp(30, 20))).toEqual({ type: "bmp", width: 30, height: 20 }));
  it("BMP の高さが負（上から下の並び）でも絶対値を返す", () =>
    expect(readImageInfo(bmp(30, -20))).toEqual({ type: "bmp", width: 30, height: 20 }));

  it("壊れたバイト列は null", () => {
    expect(readImageInfo(new Uint8Array([]))).toBeNull();
    expect(readImageInfo(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(readImageInfo(png(10, 10).subarray(0, 12))).toBeNull();
    expect(readImageInfo(jpeg(10, 10).subarray(0, 14))).toBeNull();
    expect(readImageInfo(png(0, 5))).toBeNull();
  });
});
