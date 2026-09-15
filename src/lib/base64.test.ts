// bytesToBase64 / base64ToBytes のテスト。
// 要点は「チャンク境界をまたいでも 1 バイトずつの変換と同じ結果になること」。

import { describe, it, expect } from "vitest";
import { bytesToBase64, base64ToBytes } from "./base64";

function naive(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

describe("bytesToBase64", () => {
  it("空・1 バイト・チャンク境界のちょうど前後で、1 バイトずつの変換と一致する", () => {
    for (const n of [0, 1, 2, 3, 0x7fff, 0x8000, 0x8001, 0x10000 + 5]) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 31 + 7) & 0xff;
      expect(bytesToBase64(bytes)).toBe(naive(bytes));
    }
  });

  it("全バイト値を往復できる", () => {
    const bytes = new Uint8Array(256 * 3);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("Uint8Array のビュー（オフセット付き）でも中身だけを変換する", () => {
    const buf = new Uint8Array([9, 9, 65, 66, 67, 9]);
    expect(bytesToBase64(buf.subarray(2, 5))).toBe(btoa("ABC"));
  });
});
