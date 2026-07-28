// @vitest-environment jsdom
// モバイル連携 実験フラグのテスト。
// 対象の不変条件:
// - 既定 OFF（キー無し / 壊れた値は false）
// - set → get のラウンドトリップ。OFF はキー削除で既定へ戻す
// - 切替のたびに同一タブ通知イベント（MOBILE_INBOX_FLAG_EVENT）が飛ぶ
//   （useMobileInboxFlag がこれを購読してリロード無しで反映する前提）

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MOBILE_INBOX_FLAG_EVENT,
  isMobileInboxEnabled,
  setMobileInboxEnabled,
} from "./experimental";

beforeEach(() => {
  localStorage.clear();
});

describe("モバイル連携 実験フラグ", () => {
  it("defaults to OFF when the key is absent", () => {
    expect(isMobileInboxEnabled()).toBe(false);
  });

  it("treats corrupted values as OFF", () => {
    localStorage.setItem("graphium-experimental-mobile-inbox", "yes");
    expect(isMobileInboxEnabled()).toBe(false);
  });

  it("round-trips ON/OFF and removes the key when turned OFF", () => {
    setMobileInboxEnabled(true);
    expect(isMobileInboxEnabled()).toBe(true);
    expect(localStorage.getItem("graphium-experimental-mobile-inbox")).toBe("1");

    setMobileInboxEnabled(false);
    expect(isMobileInboxEnabled()).toBe(false);
    expect(localStorage.getItem("graphium-experimental-mobile-inbox")).toBeNull();
  });

  it("dispatches the same-tab change event on every toggle", () => {
    const listener = vi.fn();
    window.addEventListener(MOBILE_INBOX_FLAG_EVENT, listener);
    try {
      setMobileInboxEnabled(true);
      setMobileInboxEnabled(false);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(MOBILE_INBOX_FLAG_EVENT, listener);
    }
  });
});
