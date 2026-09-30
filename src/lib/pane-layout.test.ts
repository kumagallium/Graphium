// 本文枠の幅ごとの余白（狭い枠だけ詰める）
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  HEADING_HANDLE_SHIFT,
  NARROW_PANE_MAX_WIDTH,
  SIDE_MENU_WIDTH,
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

  it("狭い枠は右の溝 80 を 24 に、右の溝 54 を 12 に詰める。左は見出しのハンドルが収まる 56（ラベルの有無に依らない）", () => {
    expect(narrow(true)).toEqual({ padLeft: 24, padRight: 24, gutterLeft: 56, gutterRight: 12 });
    expect(narrow(false)).toEqual(narrow(true));
  });

  it("左の溝は、見出しのハンドル（48px + ▶ の分 28px の寄せ）が枠の内側に収まる幅を残す", () => {
    const s = narrow(true);
    // 枠の端から本文の左端まで = padLeft + gutterLeft。通常ブロックは 48px、見出しは 76px 要る
    expect(s.padLeft + s.gutterLeft).toBeGreaterThanOrEqual(SIDE_MENU_WIDTH + HEADING_HANDLE_SHIFT);
  });

  it("HEADING_HANDLE_SHIFT は app.css の見出しハンドルの寄せ幅と同じ", () => {
    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8");
    const m = css.match(/\.bn-side-menu\[data-block-type="heading"\] \{([^}]*)\}/);
    expect(m, "見出しのハンドルの規則が app.css に無い").not.toBeNull();
    expect(m![1]).toContain(`translateX(-${HEADING_HANDLE_SHIFT}px)`);
  });

  it("モバイルは詰めない（別の作り）", () => {
    const s = resolvePaneSpacing({ isDesktop: false, hasLabels: true, narrow: true });
    expect(s).toEqual({ padLeft: 16, padRight: 16, gutterLeft: 54, gutterRight: 54 });
  });
});

describe("paneTextWidth（目標: 幅が足りない枠でも文字の幅を確保する）", () => {
  // 見出しのハンドルを切らない左の溝（56）を優先した結果、当初の目標（150 / 300px）は
  // 141 / 292px に下がった。offsetWidth 基準（スクロールバーを含む）
  it("853×440・右パネル手動（本文枠 257px）で 141px（詰める前は 45px）", () => {
    expect(paneTextWidth(257, wide(true))).toBe(45);
    expect(paneTextWidth(257, narrow(true))).toBe(141);
  });

  it("1024×528（本文枠 408px）で 292px（詰める前は 196px）", () => {
    expect(paneTextWidth(408, wide(true))).toBe(196);
    expect(paneTextWidth(408, narrow(true))).toBe(292);
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
