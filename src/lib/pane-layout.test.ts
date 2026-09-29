// 本文枠の幅ごとの余白（狭い枠だけ詰める）
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  NARROW_PANE_MAX_WIDTH,
  isNarrowPane,
  paneTextWidth,
  resolvePaneSpacing,
} from "./pane-layout";

const wide = (hasLabels: boolean) =>
  resolvePaneSpacing({ isDesktop: true, hasLabels, narrow: false });
const narrow = (hasLabels: boolean) =>
  resolvePaneSpacing({ isDesktop: true, hasLabels, narrow: true });

describe("isNarrowPane", () => {
  it("境目は 560px 未満が狭い", () => {
    expect(isNarrowPane(NARROW_PANE_MAX_WIDTH - 1)).toBe(true);
    expect(isNarrowPane(NARROW_PANE_MAX_WIDTH)).toBe(false);
  });
  it("測れていない（0・NaN）ときは狭いとみなさない", () => {
    expect(isNarrowPane(0)).toBe(false);
    expect(isNarrowPane(NaN)).toBe(false);
  });
});

describe("resolvePaneSpacing", () => {
  it("広い枠は今までと同じ（左 24 / 右 24 or ラベルありで 80 / 溝 54）", () => {
    expect(wide(false)).toEqual({ padLeft: 24, padRight: 24, gutterLeft: 54, gutterRight: 54 });
    expect(wide(true)).toEqual({ padLeft: 24, padRight: 80, gutterLeft: 54, gutterRight: 54 });
  });

  it("狭い枠は右の溝 80 を 24 に、左右の溝 54 を 32 / 24 に詰める（ラベルの有無に依らない）", () => {
    expect(narrow(true)).toEqual({ padLeft: 24, padRight: 24, gutterLeft: 32, gutterRight: 24 });
    expect(narrow(false)).toEqual(narrow(true));
  });

  it("左の溝は ドラッグハンドル（24px × 2）が本文の左の余白に収まる幅を残す", () => {
    const s = narrow(true);
    // 枠の端から本文の左端まで = padLeft + gutterLeft。ハンドル 48px が枠の内側に収まる
    expect(s.padLeft + s.gutterLeft).toBeGreaterThanOrEqual(48);
  });

  it("モバイルは詰めない（別の作り）", () => {
    const s = resolvePaneSpacing({ isDesktop: false, hasLabels: true, narrow: true });
    expect(s).toEqual({ padLeft: 16, padRight: 16, gutterLeft: 54, gutterRight: 54 });
  });
});

describe("paneTextWidth（目標: 幅が足りない枠でも文字の幅を確保する）", () => {
  it("853×440・右パネル手動（本文枠 257px）で 150px 以上（詰める前は 45px）", () => {
    expect(paneTextWidth(257, wide(true))).toBe(45);
    expect(paneTextWidth(257, narrow(true))).toBeGreaterThanOrEqual(150);
  });

  it("1024×528（本文枠 408px）で 300px 以上（詰める前は 196px）", () => {
    expect(paneTextWidth(408, wide(true))).toBe(196);
    expect(paneTextWidth(408, narrow(true))).toBeGreaterThanOrEqual(300);
  });

  it("境目の直前の枠でも、詰めた方が広い枠の直後より文字の幅が広がらない（逆転しない）", () => {
    // 559px（狭い）と 560px（広い）で文字の幅が飛ぶのは避けられないが、狭い側が広い側を
    // 下回ることはない
    expect(paneTextWidth(559, narrow(true))).toBeGreaterThanOrEqual(paneTextWidth(560, wide(true)));
  });
});

describe("app.css: 溝の CSS 変数を .bn-editor に効かせている", () => {
  const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
  it("[data-label-wrapper] .bn-editor が --gph-gutter-left / -right（既定 54px）で padding を持つ", () => {
    const m = css.match(/\[data-label-wrapper\] \.bn-editor \{([^}]*)\}/);
    expect(m, "規則が app.css に無い").not.toBeNull();
    expect(m![1]).toMatch(/padding-left:\s*var\(--gph-gutter-left,\s*54px\)/);
    expect(m![1]).toMatch(/padding-right:\s*var\(--gph-gutter-right,\s*54px\)/);
  });
});
