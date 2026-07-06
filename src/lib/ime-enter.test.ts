// isImeKeyEvent の挙動を担保する。
// shouldSubmitOnEnter（送信判定）のテストは MemoComposer.test.ts が持つ。
// ここではブラウザごとの確定 Enter シグナルの違いを明示的に固定する:
// - Chrome/Blink: keydown(keyCode=229, isComposing=true) → compositionend
// - WebKit(Safari / Tauri の WKWebView): compositionend → keydown(keyCode=13,
//   isComposing=false) — 「普通の Enter」に見えるため経過時間でしか判別できない

import { describe, it, expect } from "vitest";
import { isImeKeyEvent, IME_CONFIRM_KEY_WINDOW_MS, type ImeKeySignals } from "./ime-enter";

function makeSignals(overrides: Partial<ImeKeySignals> = {}): ImeKeySignals {
  return {
    composingNow: false,
    isComposing: false,
    keyCode: 13,
    msSinceCompositionEnd: 10_000,
    ...overrides,
  };
}

describe("isImeKeyEvent", () => {
  it("通常の Enter（composition と無関係）は IME キーではない", () => {
    expect(isImeKeyEvent(makeSignals())).toBe(false);
  });

  it("Chrome 順: keydown(229, isComposing=true) は IME キー", () => {
    expect(
      isImeKeyEvent(makeSignals({ keyCode: 229, isComposing: true })),
    ).toBe(true);
  });

  it("WebKit 順: compositionend 直後の keydown(13, isComposing=false) は IME キー", () => {
    // WKWebView（デスクトップ）の確定 Enter。isComposing / keyCode では
    // 判別できず、compositionend からの経過時間だけが手掛かりになる。
    expect(
      isImeKeyEvent(
        makeSignals({ keyCode: 13, isComposing: false, msSinceCompositionEnd: 5 }),
      ),
    ).toBe(true);
  });

  it("ref 追跡の composingNow が true なら IME キー", () => {
    expect(isImeKeyEvent(makeSignals({ composingNow: true }))).toBe(true);
  });

  it("時間窓の境界: 窓内は IME キー、窓以降は通常キー", () => {
    expect(
      isImeKeyEvent(
        makeSignals({ msSinceCompositionEnd: IME_CONFIRM_KEY_WINDOW_MS - 1 }),
      ),
    ).toBe(true);
    expect(
      isImeKeyEvent(
        makeSignals({ msSinceCompositionEnd: IME_CONFIRM_KEY_WINDOW_MS }),
      ),
    ).toBe(false);
  });
});
