// @vitest-environment jsdom
// 起動時ハングの回帰防止テスト（use-storage）
//
// 実機で確認したバグ: アップデート後の再起動で Tauri の起動時 IPC 競合により
// 最初の invoke("list_note_files")（= provider.init()）が永久 pending 化し、
// Rust も WebView も idle のまま「読み込み中」から抜けられない。
// 対策として init をタイムアウト＋リトライで回し、宙吊りを検知したら再発行して
// 回復する（＝ユーザーの「閉じて開き直す」を自動化）。全滅しても loading は
// 必ず解除して無限「読み込み中」を根絶する。この不変条件を固定する。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useStorage } from "./use-storage";
import { getActiveProvider, probeServerProvider } from "./registry";
import type { StorageProvider } from "./types";

// registry は副作用（fetch 機能検出・実プロバイダー初期化）を持つのでモックする。
// useStorage が使うのは initProviders / probeServerProvider / getActiveProvider /
// setActiveProvider の 4 つ。
vi.mock("./registry", () => ({
  initProviders: vi.fn(),
  probeServerProvider: vi.fn(),
  getActiveProvider: vi.fn(),
  setActiveProvider: vi.fn(),
}));

// React 18 の act() 警告を抑止（テストランナーが act 環境であることを明示）
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 実装の定数（use-storage.ts）と揃える。1 回のタイムアウトとリトライ待機。
const INIT_ATTEMPT_TIMEOUT_MS = 5000;
const INIT_RETRY_DELAY_MS = 400;

/** useStorage が触る最小限の StorageProvider スタブ。init の挙動だけ差し替える。 */
function makeProvider(init: () => Promise<void>, isSignedIn = true): StorageProvider {
  return {
    id: "filesystem",
    displayName: "mock",
    init,
    signIn() {},
    signOut() {},
    getAuthState: () => ({ isSignedIn, userEmail: null }),
    onAuthChange: () => () => {},
    clearCache() {},
  } as unknown as StorageProvider;
}

const neverResolves = () => new Promise<void>(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(probeServerProvider).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useStorage 起動時の初期化", () => {
  it("正常時は init 完了で loading を解き、認証状態を反映する", async () => {
    const provider = makeProvider(() => Promise.resolve(), true);
    vi.mocked(getActiveProvider).mockReturnValue(provider);

    const { result } = renderHook(() => useStorage());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.authenticated).toBe(true);
  });

  it("init が宙吊りでもリトライで回復し、loading を解く", async () => {
    vi.useFakeTimers();
    let calls = 0;
    // 1 回目は永久 pending（起動時 IPC 競合の宙吊りを模倣）、2 回目は成功。
    const provider = makeProvider(() => {
      calls += 1;
      return calls === 1 ? neverResolves() : Promise.resolve();
    });
    vi.mocked(getActiveProvider).mockReturnValue(provider);

    const { result } = renderHook(() => useStorage());
    expect(result.current.loading).toBe(true);

    // 1 回目のタイムアウト → リトライ待機 → 2 回目 init（即成功）まで進める。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INIT_ATTEMPT_TIMEOUT_MS + INIT_RETRY_DELAY_MS);
    });

    expect(calls).toBe(2);
    expect(result.current.loading).toBe(false);
  });

  it("最後まで宙吊りでも loading は必ず解ける（無限ローディング防止）", async () => {
    vi.useFakeTimers();
    const provider = makeProvider(neverResolves, false);
    vi.mocked(getActiveProvider).mockReturnValue(provider);

    const { result } = renderHook(() => useStorage());
    expect(result.current.loading).toBe(true);

    // 3 回分の（タイムアウト + リトライ待機）を消化しても最終的に loading は解ける。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * (INIT_ATTEMPT_TIMEOUT_MS + INIT_RETRY_DELAY_MS));
    });

    expect(result.current.loading).toBe(false);
    // init が一度も成功していないので未認証のまま UI を出す。
    expect(result.current.authenticated).toBe(false);
  });
});
