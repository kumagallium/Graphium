import { describe, expect, it } from "vitest";
import {
  STANDARD_BODY_WIDTH,
  effectivePaperMode,
  resolveBodyWidth,
  toggleA4Choice,
  toggleFullWidthChoice,
} from "./body-width";

describe("resolveBodyWidth", () => {
  it("項目が無ければ標準", () => {
    expect(resolveBodyWidth({})).toEqual(STANDARD_BODY_WIDTH);
    expect(resolveBodyWidth(undefined)).toEqual(STANDARD_BODY_WIDTH);
  });

  it("fullWidth / paperSize をそのまま読む", () => {
    expect(resolveBodyWidth({ fullWidth: true })).toEqual({ fullWidth: true, paperSize: undefined });
    expect(resolveBodyWidth({ paperSize: "a4" })).toEqual({ fullWidth: false, paperSize: "a4" });
  });

  it("知らない値は標準に戻す（将来の版が書いた値）", () => {
    expect(resolveBodyWidth({ paperSize: "letter" })).toEqual(STANDARD_BODY_WIDTH);
  });

  it("両方が立っていたら A4 を優先し、幅いっぱいは外す", () => {
    expect(resolveBodyWidth({ fullWidth: true, paperSize: "a4" })).toEqual({
      fullWidth: false,
      paperSize: "a4",
    });
  });
});

describe("メニューの排他", () => {
  it("A4 を選ぶと幅いっぱいが外れる", () => {
    expect(toggleA4Choice({ fullWidth: true, paperSize: undefined })).toEqual({
      fullWidth: false,
      paperSize: "a4",
    });
  });

  it("幅いっぱいを選ぶと A4 が外れる", () => {
    expect(toggleFullWidthChoice({ fullWidth: false, paperSize: "a4" })).toEqual({
      fullWidth: true,
      paperSize: undefined,
    });
  });

  it("入っている方をもう一度選ぶと標準に戻る", () => {
    expect(toggleA4Choice({ fullWidth: false, paperSize: "a4" })).toEqual(STANDARD_BODY_WIDTH);
    expect(toggleFullWidthChoice({ fullWidth: true, paperSize: undefined })).toEqual(
      STANDARD_BODY_WIDTH,
    );
  });

  it("どの操作の結果も両方が立たない", () => {
    const starts = [
      STANDARD_BODY_WIDTH,
      { fullWidth: true, paperSize: undefined },
      { fullWidth: false, paperSize: "a4" as const },
    ];
    for (const s of starts) {
      for (const next of [toggleA4Choice(s), toggleFullWidthChoice(s)]) {
        expect(next.fullWidth && next.paperSize === "a4").toBe(false);
      }
    }
  });
});

describe("effectivePaperMode", () => {
  it("デスクトップで A4 のときだけ a4", () => {
    expect(effectivePaperMode("a4", { isDesktop: true })).toBe("a4");
    expect(effectivePaperMode(undefined, { isDesktop: true })).toBe("standard");
  });

  it("モバイルは A4 を選んでいても標準", () => {
    expect(effectivePaperMode("a4", { isDesktop: false })).toBe("standard");
  });
});
