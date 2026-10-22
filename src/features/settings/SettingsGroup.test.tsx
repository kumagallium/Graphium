// @vitest-environment jsdom
// 初めて見たときだけ開く案内（設定 → AI の「無料枠のある接続先」）の回帰ガード

import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { resetOpenOnFirstVisitSession, useOpenOnFirstVisit } from "./SettingsGroup";

const KEY = "free-providers";
const mount = () => renderHook(() => useOpenOnFirstVisit(KEY));

describe("useOpenOnFirstVisit", () => {
  beforeEach(() => {
    localStorage.clear();
    resetOpenOnFirstVisitSession();
  });

  it("初回は開き、アプリを開き直すと閉じる", () => {
    expect(mount().result.current[0]).toBe(true);
    resetOpenOnFirstVisitSession();
    expect(mount().result.current[0]).toBe(false);
  });

  it("初回に開いたまま閉じなくても、開き直すと閉じる（開閉は次回へ持ち越さない）", () => {
    const first = mount();
    act(() => first.result.current[1]());
    act(() => first.result.current[1]());
    expect(first.result.current[0]).toBe(true);
    first.unmount();
    resetOpenOnFirstVisitSession();
    expect(mount().result.current[0]).toBe(false);
  });

  it("起動している間は、部品が外れて戻っても開閉を保つ（フォームへ切り替えて取り消したとき）", () => {
    mount().unmount();
    expect(mount().result.current[0]).toBe(true);

    const closed = mount();
    act(() => closed.result.current[1]());
    closed.unmount();
    expect(mount().result.current[0]).toBe(false);
  });

  it("次回からも、その場では開ける", () => {
    mount().unmount();
    resetOpenOnFirstVisitSession();
    const later = mount();
    act(() => later.result.current[1]());
    expect(later.result.current[0]).toBe(true);
  });
});
