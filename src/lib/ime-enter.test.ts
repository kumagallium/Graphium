// isImeKeyEvent の挙動を担保する。
// shouldSubmitOnEnter（送信判定）のテストは MemoComposer.test.ts が持つ。
// ここではブラウザごとの確定 Enter シグナルの違いを明示的に固定する:
// - Chrome/Blink: keydown(keyCode=229, isComposing=true) → compositionend
// - WebKit(Safari / Tauri の WKWebView): compositionend → keydown(keyCode=13,
//   isComposing=false) — 「普通の Enter」に見えるため経過時間でしか判別できない

import { describe, it, expect } from "vitest";
import {
  isImeKeyEvent,
  isWebKitConfirmEnter,
  IME_CONFIRM_KEY_WINDOW_MS,
  type ImeKeySignals,
} from "./ime-enter";

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

// エディタ本文（ProseMirror 内）用の「WebKit 順の確定 Enter」判定。
// isImeKeyEvent と違い、変換中のキー（isComposing / 229 / composingNow）は
// 対象に含めない — それらは prosemirror-view の composition 処理に任せ、
// 完全消費（preventDefault）してよいのは確定 Enter だけ、という契約を固定する。
describe("isWebKitConfirmEnter", () => {
  function makeEnter(overrides: Partial<ImeKeySignals> = {}) {
    return { isEnter: true, ...makeSignals(overrides) };
  }

  it("WebKit 順: compositionend 直後の素の Enter だけを確定 Enter と判定する", () => {
    expect(
      isWebKitConfirmEnter(makeEnter({ msSinceCompositionEnd: 5 })),
    ).toBe(true);
  });

  it("通常の Enter（窓の外）は対象外", () => {
    expect(isWebKitConfirmEnter(makeEnter())).toBe(false);
  });

  it("変換中のキーは対象外（prosemirror-view に任せる）", () => {
    // Chrome 順の確定: keyCode 229 / isComposing=true — 窓内でも消費しない
    expect(
      isWebKitConfirmEnter(
        makeEnter({ keyCode: 229, isComposing: true, msSinceCompositionEnd: 5 }),
      ),
    ).toBe(false);
    expect(
      isWebKitConfirmEnter(
        makeEnter({ composingNow: true, msSinceCompositionEnd: 5 }),
      ),
    ).toBe(false);
  });

  it("Enter 以外のキーは窓内でも対象外", () => {
    expect(
      isWebKitConfirmEnter({
        isEnter: false,
        ...makeSignals({ msSinceCompositionEnd: 5 }),
      }),
    ).toBe(false);
  });

  it("時間窓の境界: 窓内は確定 Enter、窓以降は通常 Enter", () => {
    expect(
      isWebKitConfirmEnter(
        makeEnter({ msSinceCompositionEnd: IME_CONFIRM_KEY_WINDOW_MS - 1 }),
      ),
    ).toBe(true);
    expect(
      isWebKitConfirmEnter(
        makeEnter({ msSinceCompositionEnd: IME_CONFIRM_KEY_WINDOW_MS }),
      ),
    ).toBe(false);
  });
});
