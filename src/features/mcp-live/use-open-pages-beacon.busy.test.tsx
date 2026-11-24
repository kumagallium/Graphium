// @vitest-environment jsdom
// use-open-pages-beacon の busy・unsafe な id・書き直しのテスト

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { registerLivePeek, type LivePeek } from "../../lib/peek-save-queue";
import {
  currentOpenWikiPages,
  OPEN_PAGES_BUSY_POLL_MS,
  OPEN_PAGES_RETRY_MAX,
  OPEN_PAGES_RETRY_MS,
  useOpenPagesBeacon,
} from "./use-open-pages-beacon";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const peek = (): LivePeek => ({ hasUnsaved: () => false, flush: () => {} });
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
};
type Data = { wikiIds: string[]; busy?: boolean };
const lastData = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[fn.mock.calls.length - 1][1] as Data;

describe("currentOpenWikiPages", () => {
  it("安全でない id があれば unsafe にし、一覧には入れない", () => {
    expect(currentOpenWikiPages(["wiki:a", "wiki:日本語", "skill:x"])).toEqual({ wikiIds: ["a"], unsafe: true });
    expect(currentOpenWikiPages(["wiki:a"])).toEqual({ wikiIds: ["a"], unsafe: false });
  });
});

describe("useOpenPagesBeacon（busy・書き直し）", () => {
  const disposers: (() => void)[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    disposers.splice(0).forEach((d) => d());
    cleanup();
    vi.useRealTimers();
  });

  it("開いているページに安全でない id があると busy: true を書く", async () => {
    disposers.push(registerLivePeek("wiki:日本語", peek()), registerLivePeek("wiki:ok", peek()));
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    const d = lastData(writeAppData);
    expect(d.busy).toBe(true);
    expect(d.wikiIds).toEqual(["ok"]);
  });

  it("busy が変わるとすぐ書き、busy でないときは busy を含めない", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    const { rerender } = renderHook(({ busy }) => useOpenPagesBeacon({ writeAppData }, true, { busy }), {
      initialProps: { busy: false },
    });
    await flush();
    expect(lastData(writeAppData)).not.toHaveProperty("busy");
    const n = writeAppData.mock.calls.length;
    rerender({ busy: true });
    await flush();
    expect(writeAppData.mock.calls.length).toBeGreaterThan(n);
    expect(lastData(writeAppData).busy).toBe(true);
    rerender({ busy: false });
    await flush();
    expect(lastData(writeAppData)).not.toHaveProperty("busy");
  });

  it("pollBusy が変わったら、見張りの間隔のうちに書く", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    let on = false;
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true, { pollBusy: () => on }));
    await flush();
    expect(lastData(writeAppData)).not.toHaveProperty("busy");
    on = true;
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_BUSY_POLL_MS); });
    await flush();
    expect(lastData(writeAppData).busy).toBe(true);
  });

  it("書き込みに失敗したら 5 秒後に書き直し、最大 3 回で止まる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => { throw new Error("x"); });
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    expect(writeAppData).toHaveBeenCalledTimes(1);
    for (let i = 0; i < OPEN_PAGES_RETRY_MAX; i++) {
      await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_RETRY_MS); });
      await flush();
    }
    // 3 秒後の定期の書き込みが 1 回挟まるので、書き直しは最大でも初回 + 3 回 + 定期の分まで
    const calls = writeAppData.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_RETRY_MS * 5); });
    await flush();
    expect(writeAppData.mock.calls.length).toBe(calls);
    expect(calls).toBeGreaterThanOrEqual(1 + OPEN_PAGES_RETRY_MAX);
    warn.mockRestore();
  });
});

import { queuePeekSave } from "../../lib/peek-save-queue";
import { OPEN_PAGES_DEBOUNCE_MS, OPEN_PAGES_SAVING_RECHECK_MS } from "./use-open-pages-beacon";

describe("useOpenPagesBeacon（閉じた直後の保存）", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("保存中の id は閉じても一覧に載り、増えるときはすぐ・終わったら外れる", async () => {
    const writeAppData = vi.fn(async (_k: string, _d: unknown) => {});
    renderHook(() => useOpenPagesBeacon({ writeAppData }, true));
    await flush();
    let release!: () => void;
    const doc = { version: 2, title: "t", pages: [], createdAt: "", modifiedAt: "" } as never;
    // エディタは登録されていないが、保存の列に書き込み中の保存がある
    void queuePeekSave("wiki:saving1", doc, () => new Promise<void>((r) => { release = r; }));
    // 増えるときは debounce せずに書く
    await flush();
    expect(lastData(writeAppData).wikiIds).toContain("saving1");
    // 保存が終わるまで 1 秒ごとに確かめても載ったまま
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_SAVING_RECHECK_MS); });
    await flush();
    expect(lastData(writeAppData).wikiIds).toContain("saving1");
    release();
    await flush();
    await act(async () => { vi.advanceTimersByTime(OPEN_PAGES_DEBOUNCE_MS + OPEN_PAGES_SAVING_RECHECK_MS); });
    await flush();
    expect(lastData(writeAppData).wikiIds).not.toContain("saving1");
  });
});
