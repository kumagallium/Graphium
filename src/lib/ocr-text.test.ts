import { describe, expect, it } from "vitest";
import {
  MAX_ALT_TEXT_CHARS,
  MAX_OCR_TEXT_CHARS,
  capOcrText,
  ocrEntriesOf,
  readOcrEntry,
  safeOcrNumber,
  sanitizeAltText,
  sanitizeOcrText,
} from "./ocr-text";
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

describe("sanitizeOcrText（表示用の読み）", () => {
  it("文字列でなければ無視する（数値・オブジェクト・配列・null）", () => {
    for (const v of [123, { a: 1 }, ["x"], null, undefined, true]) {
      expect(sanitizeOcrText(v)).toBeUndefined();
    }
  });
  it("前後の空白を落とし、空は undefined。上限以下は 1 文字も変えない", () => {
    expect(sanitizeOcrText("  焼給 800\n")).toBe("焼給 800");
    expect(sanitizeOcrText("   ")).toBeUndefined();
    const s = "あ".repeat(MAX_OCR_TEXT_CHARS);
    expect(sanitizeOcrText(s)).toBe(s);
  });
  it("5 MB の文字列は上限で切る", () => {
    expect(sanitizeOcrText("あ".repeat(5 * 1024 * 1024))!.length).toBe(MAX_OCR_TEXT_CHARS);
  });
  it("上限がサロゲートペアの途中に当たっても片割れを残さない", () => {
    const got = sanitizeOcrText("a".repeat(MAX_OCR_TEXT_CHARS - 1) + "😀😀")!;
    expect(got.length).toBe(MAX_OCR_TEXT_CHARS - 1);
    expect(got.endsWith("a")).toBe(true);
  });
  it("altText の上限は 20,000 字のまま", () => {
    expect(MAX_ALT_TEXT_CHARS).toBe(20_000);
  });
});

describe("capOcrText / safeOcrNumber / ocrEntriesOf", () => {
  it("capOcrText は上限だけかけ、空白は触らない", () => {
    expect(capOcrText("  x ")).toBe("  x ");
    expect(capOcrText("a".repeat(MAX_OCR_TEXT_CHARS + 5)).length).toBe(MAX_OCR_TEXT_CHARS);
  });
  it("数値でなければ 0", () => {
    expect(safeOcrNumber(88)).toBe(88);
    for (const v of ["88", {}, null, undefined, NaN]) expect(safeOcrNumber(v)).toBe(0);
  });
  it("mediaOcr がオブジェクトでない・エントリが null でも投げない", () => {
    for (const v of [[], "abc", null, undefined, 5]) expect(ocrEntriesOf(v)).toEqual([]);
    expect(ocrEntriesOf({ a: null, b: "x", c: { text: "t" } })).toEqual([{ text: "t" }]);
    expect(readOcrEntry("abc", "0")).toBeUndefined();
    expect(readOcrEntry({ a: null }, "a")).toBeUndefined();
  });
});
