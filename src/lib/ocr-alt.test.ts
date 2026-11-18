import { describe, expect, it } from "vitest";
import { MAX_ALT_TEXT_CHARS, sanitizeAltText } from "./ocr-alt";
import { collectOcrAltText } from "../features/media-ocr/collect";
import type { MediaOcrEntry } from "./document-types";

describe("sanitizeAltText", () => {
  it("文字列でなければ無視する（数値・オブジェクト・配列・null）", () => {
    for (const v of [123, { a: 1 }, ["x"], null, undefined, true]) {
      expect(sanitizeAltText(v)).toBeUndefined();
    }
  });
  it("前後の空白を落とし、空は undefined", () => {
    expect(sanitizeAltText("  手書き  ")).toBe("手書き");
    expect(sanitizeAltText("   ")).toBeUndefined();
  });
  it("5 MB の文字列も上限で切る", () => {
    const got = sanitizeAltText("あ".repeat(5 * 1024 * 1024))!;
    expect(got.length).toBe(MAX_ALT_TEXT_CHARS);
  });
});

describe("collectOcrAltText（信用できない入力）", () => {
  const e = (altText: unknown): MediaOcrEntry =>
    ({ text: "x", confidence: 1, lang: "", extractedAt: "", altText }) as MediaOcrEntry;
  it("数値・オブジェクトは落とし、巨大な文字列は上限で切る。投げない", () => {
    expect(collectOcrAltText({ a: e(42), b: e({ x: 1 }) })).toBeUndefined();
    const got = collectOcrAltText({ a: e("い".repeat(5_000_000)), b: e("う".repeat(5_000_000)) })!;
    expect(got.length).toBeLessThanOrEqual(MAX_ALT_TEXT_CHARS);
  });
});
