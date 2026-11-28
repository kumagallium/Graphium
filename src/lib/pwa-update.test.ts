// @vitest-environment jsdom
// PWA の更新の状態ストアのテスト。
//
// 対象の不変条件:
// - service worker が無い環境では何もしない（supported=false のまま）
// - 初回の導入（それまで制御が無かった）は「更新」と数えない
// - 制御が切り替わったら updateReady が立つ（読み込み直しは勝手にしない）
// - 確かめて何も無ければ upToDate、通信できなければ failed
// - 新しい版が見つかったら downloading → 有効になった時点で updateReady

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  __resetPwaUpdateForTest,
  checkForPwaUpdate,
  startPwaUpdateWatch,
  usePwaUpdate,
} from "./pwa-update";
import { renderHook, act, cleanup } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeWorker extends EventTarget {
  state = "installing";
  setState(s: string) {
    this.state = s;
    this.dispatchEvent(new Event("statechange"));
  }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  update = vi.fn(async () => {});
}

class FakeContainer extends EventTarget {
  controller: object | null = null;
  registration: FakeRegistration | undefined = new FakeRegistration();
  getRegistration = vi.fn(async () => this.registration);
}

function installContainer(c: FakeContainer | null): void {
  if (c) {
    Object.defineProperty(navigator, "serviceWorker", { value: c, configurable: true });
  } else {
    delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  }
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

afterEach(() => {
  cleanup();
  __resetPwaUpdateForTest();
  installContainer(null);
  vi.restoreAllMocks();
});

describe("pwa-update", () => {
  it("stays unsupported without a service worker", async () => {
    installContainer(null);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    await act(async () => { await checkForPwaUpdate(); });
    expect(result.current).toEqual({ supported: false, phase: "idle", updateReady: false });
  });

  it("becomes supported once a registration exists", async () => {
    const c = new FakeContainer();
    c.controller = {};
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    expect(result.current.supported).toBe(true);
    expect(result.current.updateReady).toBe(false);
  });

  it("does not count the first install as an update", async () => {
    const c = new FakeContainer();
    c.controller = null;
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    act(() => { c.dispatchEvent(new Event("controllerchange")); });
    expect(result.current.updateReady).toBe(false);
    // 2 回目の切り替わりは更新
    act(() => { c.dispatchEvent(new Event("controllerchange")); });
    expect(result.current.updateReady).toBe(true);
  });

  it("flags updateReady when the controller changes on a controlled page", async () => {
    const c = new FakeContainer();
    c.controller = {};
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    act(() => { c.dispatchEvent(new Event("controllerchange")); });
    expect(result.current.updateReady).toBe(true);
  });

  it("reports upToDate when a check finds nothing", async () => {
    const c = new FakeContainer();
    c.controller = {};
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    await act(async () => { await checkForPwaUpdate(); });
    expect(c.registration!.update).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("upToDate");
  });

  it("reports failed when the check cannot reach the network", async () => {
    const c = new FakeContainer();
    c.controller = {};
    c.registration!.update.mockRejectedValueOnce(new Error("offline"));
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    await act(async () => { await checkForPwaUpdate(); });
    expect(result.current.phase).toBe("failed");
    expect(result.current.updateReady).toBe(false);
  });

  it("goes downloading then updateReady when a new version is found", async () => {
    const c = new FakeContainer();
    c.controller = {};
    const reg = c.registration!;
    const worker = new FakeWorker();
    reg.update.mockImplementationOnce(async () => { reg.installing = worker; });
    installContainer(c);
    const { result } = renderHook(() => usePwaUpdate());
    await flush();
    await act(async () => { await checkForPwaUpdate(); });
    expect(result.current.phase).toBe("downloading");
    expect(result.current.updateReady).toBe(false);
    act(() => { worker.setState("activated"); });
    expect(result.current.updateReady).toBe(true);
    expect(result.current.phase).toBe("idle");
  });

  it("checks again when the app comes back to the foreground", async () => {
    const c = new FakeContainer();
    c.controller = {};
    installContainer(c);
    startPwaUpdateWatch();
    await flush();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(c.registration!.update).toHaveBeenCalledTimes(1);
    // 直後にもう一度戻ってきても、続けては確かめない
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });
    expect(c.registration!.update).toHaveBeenCalledTimes(1);
  });
});
