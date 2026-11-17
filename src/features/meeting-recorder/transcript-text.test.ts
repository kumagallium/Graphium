import { describe, expect, it } from "vitest";
import { segmentsToPlainText } from "./transcript-text";

describe("segmentsToPlainText", () => {
  it("空の発言を除き、改行でつなぐ（時刻と話者は入れない）", () => {
    const text = segmentsToPlainText([
      { track: "mic", startMs: 0, text: " こんにちは " },
      { track: "system", startMs: 1000, text: "   " },
      { track: null, startMs: 2000, text: "温度は 24 度" },
    ]);
    expect(text).toBe("こんにちは\n温度は 24 度");
  });

  it("発言が無ければ空文字", () => {
    expect(segmentsToPlainText([])).toBe("");
  });
});
