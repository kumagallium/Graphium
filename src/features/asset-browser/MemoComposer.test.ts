// shouldSubmitOnEnter の挙動を担保する。
// IME 確定 Enter（漢字変換の Enter）を誤って送信扱いしないことが目的。
//
// 関連する 4 シグナルを個別に確認する:
// 1. composingNow（ref トラッキング）
// 2. nativeEvent.isComposing（モダンブラウザ）
// 3. keyCode === 229（IME 処理中の従来シグナル）
// 4. compositionend 直後の時間差（Safari 二重 keydown 対策）

import { describe, it, expect } from "vitest";
import { shouldSubmitOnEnter, type EnterSubmitGuard } from "./MemoComposer";

function makeGuard(overrides: Partial<EnterSubmitGuard> = {}): EnterSubmitGuard {
  return {
    isEnter: true,
    shiftKey: false,
    composingNow: false,
    isComposing: false,
    keyCode: 13,
    msSinceCompositionEnd: 10_000,
    ...overrides,
  };
}

describe("shouldSubmitOnEnter", () => {
  it("通常の Enter は送信を許可する", () => {
    expect(shouldSubmitOnEnter(makeGuard())).toBe(true);
  });

  it("Enter 以外のキーは送信しない", () => {
    expect(shouldSubmitOnEnter(makeGuard({ isEnter: false }))).toBe(false);
  });

  it("Shift+Enter は改行扱いで送信しない", () => {
    expect(shouldSubmitOnEnter(makeGuard({ shiftKey: true }))).toBe(false);
  });

  it("composition 中（ref 追跡）は送信しない — 漢字変換中の Enter", () => {
    expect(shouldSubmitOnEnter(makeGuard({ composingNow: true }))).toBe(false);
  });

  it("nativeEvent.isComposing が true なら送信しない", () => {
    expect(shouldSubmitOnEnter(makeGuard({ isComposing: true }))).toBe(false);
  });

  it("keyCode 229（IME 処理中）は送信しない", () => {
    expect(shouldSubmitOnEnter(makeGuard({ keyCode: 229 }))).toBe(false);
  });

  it("compositionend から 50ms 以内の Enter は送信しない — Safari 二重 keydown 対策", () => {
    expect(shouldSubmitOnEnter(makeGuard({ msSinceCompositionEnd: 0 }))).toBe(false);
    expect(shouldSubmitOnEnter(makeGuard({ msSinceCompositionEnd: 49 }))).toBe(false);
  });

  it("compositionend から 50ms 以上経った Enter は送信する", () => {
    expect(shouldSubmitOnEnter(makeGuard({ msSinceCompositionEnd: 50 }))).toBe(true);
    expect(shouldSubmitOnEnter(makeGuard({ msSinceCompositionEnd: 200 }))).toBe(true);
  });
});
