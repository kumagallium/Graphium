import { describe, it, expect } from "vitest";
import { linkModifiedIso, plainLabel, isValidSize } from "./link-safe";

describe("linkModifiedIso", () => {
  it("正しい値は ISO 文字列", () => {
    expect(linkModifiedIso(1700000000000)).toBe("2023-11-14T22:13:20.000Z");
  });
  it("壊れた値・範囲外は undefined（落ちない）", () => {
    for (const v of [1e300, -1, 0, NaN, Infinity, 8.64e15 + 1, "1", null, undefined]) {
      expect(linkModifiedIso(v)).toBeUndefined();
    }
    expect(linkModifiedIso(8.64e15)).toBeDefined();
  });
});

describe("isValidSize", () => {
  it("0 以上の安全な整数だけ", () => {
    expect(isValidSize(0)).toBe(true);
    expect(isValidSize(-1)).toBe(false);
    expect(isValidSize(1.5)).toBe(false);
    expect(isValidSize(1e300)).toBe(false);
  });
});

describe("plainLabel", () => {
  it("改行・制御文字を空白にして 1 行にまとめる", () => {
    expect(plainLabel("a\nb\r\n\tc\u0000d e")).toBe("a b c d e");
  });
  it("連続する空白（全角を含む）を 1 つに", () => {
    expect(plainLabel("実験　　データ   最終")).toBe("実験 データ 最終");
  });
  it("長さを切る（全角・サロゲートペアも 1 文字）", () => {
    expect(plainLabel("あ".repeat(500), 10)).toBe(`${"あ".repeat(10)}…`);
    expect(plainLabel("😀".repeat(5), 3)).toBe("😀😀😀…");
    expect(plainLabel("short", 10)).toBe("short");
  });
});
