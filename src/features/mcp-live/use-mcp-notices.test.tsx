// @vitest-environment jsdom
// use-mcp-notices のテスト（drainOnce が 1 本にまとまる・drainer の登録と解除・10 秒の見張り）

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { drainExternalChanges } from "../../lib/external-changes";
import { MCP_LIVE_FORMAT_VERSION, makeNoticeKey } from "./format";
import { drainOnce, MCP_NOTICE_POLL_MS, resetMcpNoticeInflightForTest, useMcpNotices } from "./use-mcp-notices";
import type { McpNoticeStorage } from "./notices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeProvider() {
  const at = new Date().toISOString();
  const data = new Map<string, unknown>([
    [makeNoticeKey(new Date(), "a"), { formatVersion: MCP_LIVE_FORMAT_VERSION, at, pages: [{ wikiId: "a", title: "t", created: false }] }],
  ]);
  const provider = {
    listAppDataKeys: vi.fn(async (p: string) => [...data.keys()].filter((k) => k.startsWith(p))),
    readAppData: vi.fn(async (k: string) => data.get(k) ?? null),
    writeAppData: vi.fn(async () => {}),
    deleteAppData: vi.fn(async (k: string) => { data.delete(k); }),
  };
  return { provider, data };
}

describe("drainOnce", () => {
  beforeEach(() => resetMcpNoticeInflightForTest());
  it("実行中に呼ばれたら同じ Promise を返し、知らせを二重に処理しない", async () => {
    const { provider } = makeProvider();
    const storage = provider as unknown as McpNoticeStorage;
    let release!: () => void;
    const handle = vi.fn(() => new Promise<void>((r) => { release = r; }));
    const p1 = drainOnce(storage, handle);
    const p2 = drainOnce(storage, handle);
    expect(p2).toBe(p1);
    await vi.waitFor(() => expect(handle).toHaveBeenCalledTimes(1));
    release();
    await p1;
    expect(handle).toHaveBeenCalledTimes(1);
  });
});

describe("useMcpNotices", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMcpNoticeInflightForTest();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("すぐ処理し、10 秒ごとに見張り、アンマウントで止まる", async () => {
    const { provider } = makeProvider();
    const handle = vi.fn(async () => {});
    const { unmount } = renderHook(() => useMcpNotices({ enabled: true, provider, handle }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(handle).toHaveBeenCalledTimes(1);
    provider.listAppDataKeys.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(MCP_NOTICE_POLL_MS); });
    expect(provider.listAppDataKeys).toHaveBeenCalledTimes(1);
    unmount();
    provider.listAppDataKeys.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(MCP_NOTICE_POLL_MS * 3); });
    expect(provider.listAppDataKeys).not.toHaveBeenCalled();
  });

  it("drainExternalChanges から同じ処理が走り、解除後は走らない", async () => {
    const { provider } = makeProvider();
    const handle = vi.fn(async () => {});
    const { unmount } = renderHook(() => useMcpNotices({ enabled: true, provider, handle }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    provider.listAppDataKeys.mockClear();
    await act(async () => { await drainExternalChanges(); });
    expect(provider.listAppDataKeys).toHaveBeenCalledTimes(1);
    unmount();
    provider.listAppDataKeys.mockClear();
    await act(async () => { await drainExternalChanges(); });
    expect(provider.listAppDataKeys).not.toHaveBeenCalled();
  });

  it("非対応の保存先・無効のときは何もしない", async () => {
    const handle = vi.fn(async () => {});
    renderHook(() => useMcpNotices({ enabled: true, provider: {}, handle }));
    const { provider } = makeProvider();
    renderHook(() => useMcpNotices({ enabled: false, provider, handle }));
    await act(async () => { await vi.advanceTimersByTimeAsync(MCP_NOTICE_POLL_MS); });
    expect(provider.listAppDataKeys).not.toHaveBeenCalled();
  });
});
