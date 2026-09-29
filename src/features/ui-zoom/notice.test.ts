// 画面が狭い環境の案内を出す条件と、トーストの出し分けを固定する。

import { describe, expect, it } from "vitest";
import { formatZoomPercent } from "./format";
import { shouldShowZoomHint, shouldShowZoomToast, type ZoomHintInput } from "./notice";

/** Windows 150% の 1920×1080 ノート PC（CSS px で約 1280×660）の、まだ何も変えていないデスクトップ */
const base: ZoomHintInput = {
  innerWidth: 1280,
  innerHeight: 660,
  dismissed: false,
  welcomeShown: true,
  isDesktop: true,
  level: 1,
};

describe("shouldShowZoomHint", () => {
  it("狭い画面のデスクトップで、まだ何も変えていなければ出す", () => {
    expect(shouldShowZoomHint(base)).toBe(true);
  });

  it("幅が 1366 以下、または高さが 720 以下なら狭い（どちらか）", () => {
    expect(shouldShowZoomHint({ ...base, innerWidth: 1366, innerHeight: 900 })).toBe(true);
    expect(shouldShowZoomHint({ ...base, innerWidth: 1600, innerHeight: 720 })).toBe(true);
    expect(shouldShowZoomHint({ ...base, innerWidth: 1367, innerHeight: 721 })).toBe(false);
  });

  it("幅 768 未満（モバイルのレイアウト）では出さない", () => {
    expect(shouldShowZoomHint({ ...base, innerWidth: 767 })).toBe(false);
    expect(shouldShowZoomHint({ ...base, innerWidth: 768 })).toBe(true);
  });

  it("閉じた記録があれば出さない", () => {
    expect(shouldShowZoomHint({ ...base, dismissed: true })).toBe(false);
  });

  it("ようこそを閉じる前は出さない（初回は閉じた後に出す）", () => {
    expect(shouldShowZoomHint({ ...base, welcomeShown: false })).toBe(false);
  });

  it("デスクトップで倍率が 100% でなければ出さない（すでに変えた人）", () => {
    expect(shouldShowZoomHint({ ...base, level: 0.9 })).toBe(false);
    expect(shouldShowZoomHint({ ...base, level: 1.25 })).toBe(false);
  });

  it("デスクトップで倍率がまだ取れていなければ出さない", () => {
    expect(shouldShowZoomHint({ ...base, level: null })).toBe(false);
  });

  it("ブラウザ版は倍率を見ない（ブラウザの拡大縮小は取れない）", () => {
    expect(shouldShowZoomHint({ ...base, isDesktop: false, level: null })).toBe(true);
  });
});

describe("shouldShowZoomToast", () => {
  it("キー・ホイール・メニューで変えたときだけ出す", () => {
    expect(shouldShowZoomToast("key")).toBe(true);
    expect(shouldShowZoomToast("wheel")).toBe(true);
    expect(shouldShowZoomToast("menu")).toBe(true);
  });

  it("設定画面・案内のボタンからは出さない（その場に倍率が見えている）", () => {
    expect(shouldShowZoomToast("settings")).toBe(false);
    expect(shouldShowZoomToast("hint")).toBe(false);
  });
});

describe("formatZoomPercent", () => {
  it("段の表の値を % 表記にする（0.67 は 67%）", () => {
    expect(formatZoomPercent(0.5)).toBe("50%");
    expect(formatZoomPercent(0.67)).toBe("67%");
    expect(formatZoomPercent(0.9)).toBe("90%");
    expect(formatZoomPercent(1)).toBe("100%");
    expect(formatZoomPercent(1.1)).toBe("110%");
    expect(formatZoomPercent(1.25)).toBe("125%");
  });
});
