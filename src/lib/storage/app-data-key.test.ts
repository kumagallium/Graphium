import { describe, it, expect } from "vitest";
import { isValidAppDataKey, assertValidAppDataKey } from "./app-data-key";

describe("isValidAppDataKey", () => {
  it("英数字・_・- の 1〜200 文字を受け付ける", () => {
    expect(isValidAppDataKey("maint-run-abc_123")).toBe(true);
    expect(isValidAppDataKey("a")).toBe(true);
    expect(isValidAppDataKey("a".repeat(200))).toBe(true);
  });

  it("空文字・201 文字以上を拒否する", () => {
    expect(isValidAppDataKey("")).toBe(false);
    expect(isValidAppDataKey("a".repeat(201))).toBe(false);
  });

  it("パス区切り・ドット・コロン・空白・改行・非文字列を拒否する", () => {
    for (const bad of ["a/b", "a\\b", "..", ".x", "snapshot:1", "a b", "a\n", "あ", "a\0"]) {
      expect(isValidAppDataKey(bad)).toBe(false);
    }
    expect(isValidAppDataKey(undefined)).toBe(false);
    expect(isValidAppDataKey(1)).toBe(false);
  });
});

describe("assertValidAppDataKey", () => {
  it("不正なら例外、正しければそのまま返す", () => {
    expect(assertValidAppDataKey("ok-1")).toBe("ok-1");
    expect(() => assertValidAppDataKey("a/b", "prefix")).toThrow("prefix");
  });
});
