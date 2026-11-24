// @vitest-environment jsdom
// use-open-pages-beacon のテスト（書く中身・タイミング・StrictMode）

import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { registerLivePeek, type LivePeek } from "../../lib/peek-save-queue";
import { OPEN_PAGES_KEY, parseOpenPages } from "./format";
import {
  currentOpenWikiIds,
  OPEN_PAGES_DEBOUNCE_MS,
  OPEN_PAGES_RECHECK_MS,
  useOpenPagesBeacon,
} from "./use-open-pages-beacon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
const peek = (remote = false): LivePeek => ({ hasUnsaved: () => false, flush: () => {}, remote });
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};
type Call = [string, { at: string; wikiIds: string[] }];

describe("currentOpenWikiIds", () => {
  it("wiki: だけを接頭辞を外して返し、不正な id を除く", () => {
    expect(currentOpenWikiIds(["wiki:a", "skill:b", "new:1", "wiki:../x", "wiki:a", "note-c"])).toEqual(["a"]);
  });
});

describe("useOpenPagesBeacon", () => {
  const disposers: (() => void)[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    cleanup();
    vi.useRealTimers();
  });

  it("有効になった直後に format.ts の形で書く（別ウィンドウの代理も含む）", async () => {
    disposers.push(registerLivePeek("wiki:w1", peek()), registerLivePeek("wiki:w2", peek(true)), registerLivePeek("skill:s", peek()));
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    const [key, data] = writeAppData.mock.calls[0] as unknown as Call;
    expect(key).toBe(OPEN_PAGES_KEY);
    expect(parseOpenPages(data)).not.toBeNull();
    expect([...data.wikiIds].sort()).toEqual(["w1", "w2"]);
  });

  it("3 秒後にもう一度書き、増えるときはすぐ・減るときは debounce して書く", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_RECHECK_MS); });
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(2);
    // 増えるときは debounce せずにすぐ書く
    const dispose = registerLivePeek("wiki:w9", peek());
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(3);
    expect((writeAppData.mock.calls[2] as unknown as Call)[1].wikiIds).toEqual(["w9"]);
    // 減るときだけ debounce して書く
    dispose();
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(3);
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_DEBOUNCE_MS); });
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(4);
    expect((writeAppData.mock.calls[3] as unknown as Call)[1].wikiIds).toEqual([]);
  });

  it("focus で書く・アンマウントで止まる", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    const { unmount } = renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(2);
    unmount();
    writeAppData.mockClear();
    window.dispatchEvent(new Event("focus"));
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_RECHECK_MS * 3); });
    await flush();
    expect(writeAppData).not.toHaveBeenCalled();
  });

  it("StrictMode でも壊れない（3 秒後の書き込みは残る）", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true), { wrapper: strict });
    await flush();
    writeAppData.mockClear();
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_RECHECK_MS); });
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(1);
  });

  it("書き込みの失敗は握る・無効 / writeAppData なしでは書かない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi.fn(async () => { throw new Error("x"); });
    renderHook(() => useOpenPagesBeacon({ writeAppData: failing }, true));
    await flush();
    expect(failing).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const off = vi.fn(async () => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData: off }, false));
    renderHook(() => useOpenPagesBeacon({}, true));
    renderHook(() => useOpenPagesBeacon(null, true));
    await flush();
    expect(off).not.toHaveBeenCalled();
  });
});
