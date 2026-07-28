// @vitest-environment jsdom
// スタンドアロン push 設定フック（最小設定シート・オプトイン接続用）のテスト。
//
// 対象の不変条件:
// - active=false の間は push モジュールを動的 import しない（オプトインカードが
//   出ているだけの従来ホームでは何も読まない）
// - active になったらロード → configured/connected/client_id 上書きを読み、
//   configured なら prepare を先回りする（connect のジェスチャ内同期契約の前提）
// - connectGoogle 成功: connected=true + プロバイダ永続（graphium-push-provider）+
//   onConnected（親がフラグを立てる）/ 失敗: connectError に載せ onConnected は呼ばない
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
    setGoogleClientIdOverride: h.setGoogleClientIdOverride,
    setPushProvider: h.setPushProvider,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  h.configured.value = true;
  h.connected.value = false;
  h.override.value = null;
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

  it("connectGoogle success: connected + provider persisted + onConnected", async () => {
    const onConnected = vi.fn();
    const { result } = renderHook(() => usePushSettings(true, { onConnected }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      result.current.connectGoogle();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.connected).toBe(true));
    // 「実際に使えた」経路だけを記録する（P1.5 OneDrive の分岐点）
    expect(h.setPushProvider).toHaveBeenCalledWith("google-drive");
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(result.current.connectError).toBeNull();
  });

  it("connectGoogle failure: surfaces the error and never calls onConnected", async () => {
    h.connectImpl.mockImplementation(() => Promise.reject(new Error("Popup closed by user")));
    const onConnected = vi.fn();
    const { result } = renderHook(() => usePushSettings(true, { onConnected }));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => {
      result.current.connectGoogle();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.connectError).toBe("Popup closed by user"));
    expect(result.current.connected).toBe(false);
    expect(h.setPushProvider).not.toHaveBeenCalled();
    expect(onConnected).not.toHaveBeenCalled();
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
});
