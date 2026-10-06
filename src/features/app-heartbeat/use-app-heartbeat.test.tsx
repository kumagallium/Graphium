// @vitest-environment jsdom
// use-app-heartbeat のテスト（web: 30 秒周期・アンマウント・StrictMode / desktop: invoke）

import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

const invokeMock = vi.fn(async (_cmd: string, _args?: unknown) => undefined);
const isTauriMock = vi.fn(() => false);
const getRootMock = vi.fn(async () => ({ current: "/root-a", defaultRoot: "/d", isCustom: false }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (c: string, a?: unknown) => invokeMock(c, a) }));
vi.mock("../../lib/platform", () => ({ isTauri: () => isTauriMock() }));
vi.mock("../../lib/graphium-root", () => ({ getGraphiumRoot: () => getRootMock() }));
vi.mock("../../lib/updater", () => ({ getAppVersion: async () => "9.9.9" }));

import { useAppHeartbeat, WEB_HEARTBEAT_INTERVAL_MS } from "./use-app-heartbeat";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe("useAppHeartbeat (web)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    isTauriMock.mockReturnValue(false);
    invokeMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("即時と 30 秒ごとに writeAppData する", async () => {
    const writeAppData = vi.fn(async () => {});
    renderHook(() => useAppHeartbeat({ writeAppData }, true));
    expect(writeAppData).toHaveBeenCalledTimes(1);
    const [key, data] = writeAppData.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(key).toBe("app-heartbeat");
    expect(data.via).toBe("web");
    expect(typeof data.at).toBe("string");
    expect(data).not.toHaveProperty("pid");
    await act(async () => { vi.advanceTimersByTime(WEB_HEARTBEAT_INTERVAL_MS); });
    expect(writeAppData).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(WEB_HEARTBEAT_INTERVAL_MS); });
    expect(writeAppData).toHaveBeenCalledTimes(3);
  });

  it("アンマウントで止まる", async () => {
    const writeAppData = vi.fn(async () => {});
    const { unmount } = renderHook(() => useAppHeartbeat({ writeAppData }, true));
    unmount();
    writeAppData.mockClear();
    await act(async () => { vi.advanceTimersByTime(WEB_HEARTBEAT_INTERVAL_MS * 3); });
    expect(writeAppData).not.toHaveBeenCalled();
  });

  it("StrictMode でも interval は 1 本だけ", async () => {
    const writeAppData = vi.fn(async () => {});
    renderHook(() => useAppHeartbeat({ writeAppData }, true), { wrapper: strict });
    writeAppData.mockClear();
    await act(async () => { vi.advanceTimersByTime(WEB_HEARTBEAT_INTERVAL_MS); });
    expect(writeAppData).toHaveBeenCalledTimes(1);
  });

  it("pagehide で at: 0 を書く・書き込み失敗は握る", async () => {
    const writeAppData = vi.fn(async () => { throw new Error("x"); });
    renderHook(() => useAppHeartbeat({ writeAppData }, true));
    window.dispatchEvent(new Event("pagehide"));
    const calls = writeAppData.mock.calls as unknown as [string, Record<string, unknown>][];
    const last = calls[calls.length - 1];
    expect(last[1].at).toBe(0);
  });

  it("enabled=false / provider なしでは書かない", () => {
    const writeAppData = vi.fn(async () => {});
    renderHook(() => useAppHeartbeat({ writeAppData }, false));
    renderHook(() => useAppHeartbeat(null, true));
    expect(writeAppData).not.toHaveBeenCalled();
  });
});

describe("useAppHeartbeat (desktop)", () => {
  beforeEach(() => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockClear();
    getRootMock.mockResolvedValue({ current: "/root-a", defaultRoot: "/d", isCustom: false });
  });
  afterEach(() => cleanup());

  it("root を渡して start_app_heartbeat を 1 回呼ぶ（StrictMode でも）", async () => {
    const writeAppData = vi.fn(async () => {});
    renderHook(() => useAppHeartbeat({ writeAppData }, true), { wrapper: strict });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("start_app_heartbeat", { root: "/root-a" });
    expect(writeAppData).not.toHaveBeenCalled();
  });

  it("root が変われば呼び直す", async () => {
    const p1 = { writeAppData: vi.fn(async () => {}) };
    const p2 = { writeAppData: vi.fn(async () => {}) };
    const { rerender } = renderHook(({ p }) => useAppHeartbeat(p, true), { initialProps: { p: p1 } });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    getRootMock.mockResolvedValue({ current: "/root-b", defaultRoot: "/d", isCustom: true });
    rerender({ p: p2 });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("start_app_heartbeat", { root: "/root-b" });
  });
});
