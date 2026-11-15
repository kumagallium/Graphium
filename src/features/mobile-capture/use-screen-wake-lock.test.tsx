// @vitest-environment jsdom
// 録音中の画面維持（Screen Wake Lock）のテスト。
//
// 守りたい不変条件:
// - 録音中だけロックを取り、終わったら必ず離す（点けっぱなしで電池を減らさない）
// - 対応していないブラウザ・断られたときも落ちない（録音を巻き添えにしない）
// - ページが隠れて OS がロックを外したあと、戻ってきたら取り直す

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup, act } from "@testing-library/react";
import { useScreenWakeLock } from "./use-screen-wake-lock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubWakeLock(request: (type: string) => Promise<{ release: () => Promise<void> }>) {
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  cleanup();
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

const flush = () => act(async () => { await Promise.resolve(); });

describe("useScreenWakeLock", () => {
  it("holds the screen on only while active, and lets go afterwards", async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    stubWakeLock(request);

    const { rerender } = renderHook(({ active }) => useScreenWakeLock(active), {
      initialProps: { active: false },
    });
    expect(request).not.toHaveBeenCalled();

    rerender({ active: true });
    await flush();
    expect(request).toHaveBeenCalledWith("screen");
    expect(release).not.toHaveBeenCalled();

    rerender({ active: false });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after recording already ended", async () => {
    const release = vi.fn(() => Promise.resolve());
    let resolve: (s: { release: () => Promise<void> }) => void = () => {};
    stubWakeLock(() => new Promise((r) => { resolve = r; }));

    const { unmount } = renderHook(() => useScreenWakeLock(true));
    unmount();
    resolve({ release });
    await flush();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("takes the lock again when the page comes back while still active", async () => {
    const request = vi.fn(() => Promise.resolve({ release: () => Promise.resolve() }));
    stubWakeLock(request);

    renderHook(() => useScreenWakeLock(true));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    expect(request).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does nothing where the browser has no wake lock, or refuses it", async () => {
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
    cleanup();

    stubWakeLock(() => Promise.reject(new Error("NotAllowedError")));
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
    await flush();
  });
});
