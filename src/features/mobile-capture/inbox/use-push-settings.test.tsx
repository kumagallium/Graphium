// @vitest-environment jsdom
// スタンドアロン push 設定フック（最小設定シート用）のテスト。
//
// 対象の不変条件:
// - active=false の間は push モジュールを動的 import しない（ホームを見ているだけの
//   ときは何も読まない）
// - active になったらロード → configured/connected/client_id 上書きを読み、
//   configured なら prepare を先回りする（connect のジェスチャ内同期契約の前提）
// - 接続そのものはここが担わない（usePushQueue.connectAndDrain 一本）
// - disconnect は pusher.disconnect() に委譲して connected を落とす
// - PUSH_STATUS_EVENT（他面での接続/切断/client_id 変更）で状態を読み直す
//
// push モジュールはモック（実 gsi / IndexedDB には触れない）。

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { usePushSettings } from "./use-push-settings";
import { PUSH_STATUS_EVENT } from "./push-events";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  pushModuleLoads: vi.fn(),
  configured: { value: true },
  connected: { value: false },
  override: { value: null as string | null },
  // connect の結果は呼び出し時に生成する（reject を先に作り置きすると
  // ハンドラ装着前の unhandled rejection になるため）
  connectImpl: vi.fn((): Promise<void> => Promise.resolve()),
  prepare: vi.fn(() => Promise.resolve()),
  disconnect: vi.fn(),
  setPushProvider: vi.fn(),
  setGoogleClientIdOverride: vi.fn(),
  stayConfig: { value: null as { clientId: string; brokerUrl: string } | null },
  authMode: { value: "hourly" as "stay" | "hourly" },
  legacy: { value: false },
  setAuthModePreference: vi.fn(),
}));

vi.mock("./push", () => {
  h.pushModuleLoads();
  return {
    DEFAULT_GOOGLE_PUSH_CLIENT_ID: "bundled.apps.googleusercontent.com",
    GoogleDrivePusher: class {
      isConfigured() { return h.configured.value; }
      isConnected() { return h.connected.value; }
      prepare() { return h.prepare(); }
      connect() { return h.connectImpl(); }
      disconnect() { h.disconnect(); }
    },
    getGoogleClientIdOverride: () => h.override.value,
    getStayConnectedConfig: () => h.stayConfig.value,
    resolveAuthMode: () => h.authMode.value,
    isLegacyPushUser: () => h.legacy.value,
    setAuthModePreference: h.setAuthModePreference,
    setGoogleClientIdOverride: h.setGoogleClientIdOverride,
    setPushProvider: h.setPushProvider,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.value = true;
  h.connected.value = false;
  h.override.value = null;
  h.stayConfig.value = null;
  h.authMode.value = "hourly";
  h.legacy.value = false;
  h.connectImpl.mockImplementation(() => Promise.resolve());
});

afterEach(cleanup);

describe("usePushSettings", () => {
  it("stays inert while inactive: no dynamic module load", async () => {
    const { result } = renderHook(() => usePushSettings(false));
    await act(async () => { await Promise.resolve(); });
    expect(h.pushModuleLoads).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);
  });

  it("loads on activation, reads status, and pre-prepares for the gesture contract", async () => {
    h.override.value = "own-id.apps.googleusercontent.com";
    const { result } = renderHook(() => usePushSettings(true));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.configured).toBe(true);
    expect(result.current.connected).toBe(false);
    expect(result.current.hasBundledId).toBe(true);
    expect(result.current.clientIdOverride).toBe("own-id.apps.googleusercontent.com");
    // connect() をジェスチャ内で同期的に呼べるよう prepare は先回り
    expect(h.prepare).toHaveBeenCalled();
  });

  // 接続導線は 1 本（usePushQueue.connectAndDrain）— 実験オプトイン専用だった
  // スタンドアロン connect はフラグ撤去で用が無くなったので生やさない
  it("exposes no connect of its own (connecting is the queue hook's job)", async () => {
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect("connectGoogle" in result.current).toBe(false);
    expect(h.setPushProvider).not.toHaveBeenCalled();
  });

  it("disconnect delegates to the pusher and drops connected", async () => {
    h.connected.value = true;
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      result.current.disconnect();
    });
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(result.current.connected).toBe(false);
  });

  it("re-reads status when PUSH_STATUS_EVENT fires (changes made elsewhere)", async () => {
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.connected).toBe(false);

    h.connected.value = true;
    h.override.value = "changed.apps.googleusercontent.com";
    act(() => {
      window.dispatchEvent(new CustomEvent(PUSH_STATUS_EVENT));
    });

    await waitFor(() => expect(result.current.connected).toBe(true));
    expect(result.current.clientIdOverride).toBe("changed.apps.googleusercontent.com");
  });

  it("saves and clears the client_id override through the module", async () => {
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => {
      result.current.saveClientId("mine.apps.googleusercontent.com");
    });
    expect(h.setGoogleClientIdOverride).toHaveBeenCalledWith("mine.apps.googleusercontent.com");

    act(() => {
      result.current.clearClientId();
    });
    expect(h.setGoogleClientIdOverride).toHaveBeenCalledWith(null);
  });

  it("exposes stay state from the module", async () => {
    h.stayConfig.value = { clientId: "c", brokerUrl: "https://b.example" };
    h.authMode.value = "stay";
    h.legacy.value = true;
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.stayAvailable).toBe(true);
    expect(result.current.stayConnected).toBe(true);
    expect(result.current.legacyUser).toBe(true);
  });

  it("is not stay-available while the module reports no stay config", async () => {
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.stayAvailable).toBe(false);
    expect(result.current.stayConnected).toBe(false);
  });

  it("setStayConnected saves the preference, disconnects, and re-prepares", async () => {
    h.stayConfig.value = { clientId: "c", brokerUrl: "https://b.example" };
    h.connected.value = true;
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.connected).toBe(true));
    h.prepare.mockClear();

    act(() => {
      result.current.setStayConnected(true);
    });
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.setAuthModePreference).toHaveBeenCalledWith("stay");
    expect(h.prepare).toHaveBeenCalled(); // 次の接続をジェスチャ内で同期に呼べるよう作り直す

    act(() => {
      result.current.setStayConnected(false);
    });
    expect(h.setAuthModePreference).toHaveBeenCalledWith("hourly");
  });

  it("disconnects before saving an override when it flips the auth mode (stay -> hourly)", async () => {
    h.stayConfig.value = { clientId: "c", brokerUrl: "https://b.example" };
    h.authMode.value = "stay";
    h.connected.value = true;
    const order: string[] = [];
    h.disconnect.mockImplementation(() => { order.push("disconnect"); });
    h.setGoogleClientIdOverride.mockImplementation((v: string | null) => {
      h.override.value = v;
      // 自前 client があると stay は使えず hourly になる
      h.authMode.value = v ? "hourly" : "stay";
      order.push(v === null ? "set:null" : "set:" + v);
    });
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.connected).toBe(true));
    order.length = 0;

    act(() => {
      result.current.saveClientId("mine.apps.googleusercontent.com");
    });
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    // 最後の保存より前に切断している
    expect(order.lastIndexOf("disconnect")).toBeLessThan(order.lastIndexOf("set:mine.apps.googleusercontent.com"));
    expect(h.override.value).toBe("mine.apps.googleusercontent.com");
    h.setGoogleClientIdOverride.mockReset();
    h.disconnect.mockReset();
  });

  it("keeps the connection when saving an override does not change the mode", async () => {
    h.connected.value = true;
    const { result } = renderHook(() => usePushSettings(true));
    await waitFor(() => expect(result.current.connected).toBe(true));
    act(() => {
      result.current.saveClientId("mine.apps.googleusercontent.com");
    });
    expect(h.disconnect).not.toHaveBeenCalled();
  });
});
