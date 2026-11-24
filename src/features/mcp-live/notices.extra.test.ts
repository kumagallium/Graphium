import { describe, expect, it, vi } from "vitest";
import { MCP_LIVE_FORMAT_VERSION, MCP_NOTICE_PREFIX, makeNoticeKey, parseNotice } from "./format";
import {
  drainMcpNotices,
  MCP_NOTICE_RETRY_WINDOW_MS,
  requireMemoIndexLoaded,
  shouldRetryFailedPages,
  type McpNoticeStorage,
} from "./notices";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");
const AT = new Date(NOW).toISOString();

describe("drainMcpNotices（読めない・未来の知らせ）", () => {
  it("読めない（null）知らせは消す・未来すぎる時刻の知らせは handle せずに捨てる", async () => {
    const kNull = `${MCP_NOTICE_PREFIX}0-null`;
    const futureAt = new Date(NOW + 10 * 60_000).toISOString();
    const kFuture = makeNoticeKey(new Date(futureAt), "f");
    const futureBody = {
      formatVersion: MCP_LIVE_FORMAT_VERSION,
      at: futureAt,
      pages: [{ wikiId: "f", title: "f", created: false }],
    };
    const deleted: string[] = [];
    const storage: McpNoticeStorage = {
      listAppDataKeys: async () => [kNull, kFuture],
      readAppData: async (k) => (k === kFuture ? futureBody : null),
      deleteAppData: async (k) => void deleted.push(k),
    };
    const handle = vi.fn(async () => {});
    expect(await drainMcpNotices(storage, handle, () => NOW)).toBe(0);
    expect(handle).not.toHaveBeenCalled();
    expect(deleted.sort()).toEqual([kNull, kFuture].sort());
  });
});

describe("requireMemoIndexLoaded", () => {
  const withMemo = parseNotice({
    formatVersion: MCP_LIVE_FORMAT_VERSION,
    at: AT,
    pages: [],
    memoBacklinks: { captureId: "m1", pages: [{ wikiId: "a", title: "t" }] },
  })!;
  const without = parseNotice({ formatVersion: MCP_LIVE_FORMAT_VERSION, at: AT, pages: [] })!;

  it("メモの逆リンクがあるのに索引が未読込なら例外を投げる", () => {
    expect(() => requireMemoIndexLoaded(withMemo, () => false)).toThrow();
    expect(() => requireMemoIndexLoaded(withMemo, () => true)).not.toThrow();
  });
  it("逆リンクが無い知らせは、索引が未読込でも通す", () => {
    expect(() => requireMemoIndexLoaded(without, () => false)).not.toThrow();
  });
  it("drainMcpNotices と組み合わせると、未読込の間は知らせが残る", async () => {
    const k = makeNoticeKey(new Date(AT), "m");
    const data = new Map<string, unknown>([[k, { ...withMemo }]]);
    const storage: McpNoticeStorage = {
      listAppDataKeys: async () => [...data.keys()],
      readAppData: async (key) => data.get(key) ?? null,
      deleteAppData: async (key) => void data.delete(key),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const n = await drainMcpNotices(storage, async (nt) => requireMemoIndexLoaded(nt, () => false), () => NOW);
    warn.mockRestore();
    expect(n).toBe(0);
    expect(data.has(k)).toBe(true);
  });
});

describe("shouldRetryFailedPages", () => {
  const notice = parseNotice({ formatVersion: MCP_LIVE_FORMAT_VERSION, at: AT, pages: [] })!;
  it("読めなかったページがあり、知らせから 2 分以内なら再試行する", () => {
    expect(shouldRetryFailedPages(notice, 1, NOW + 1000)).toBe(true);
    expect(shouldRetryFailedPages(notice, 1, NOW + MCP_NOTICE_RETRY_WINDOW_MS)).toBe(true);
  });
  it("2 分を超えたら諦める・失敗が無ければ再試行しない", () => {
    expect(shouldRetryFailedPages(notice, 1, NOW + MCP_NOTICE_RETRY_WINDOW_MS + 1)).toBe(false);
    expect(shouldRetryFailedPages(notice, 0, NOW)).toBe(false);
  });
});

import { MCP_NOTICE_NULL_GRACE_MS, noticeKeyTime, recordMemoBacklinks } from "./notices";

describe("null の知らせ（一時的な読み込み失敗かもしれない）", () => {
  const run = async (keyAtMs: number | "bad") => {
    const key = keyAtMs === "bad" ? `${MCP_NOTICE_PREFIX}zzz` : makeNoticeKey(new Date(keyAtMs), "a");
    const deleted: string[] = [];
    const storage: McpNoticeStorage = {
      listAppDataKeys: async () => [key],
      readAppData: async () => null,
      deleteAppData: async (k) => void deleted.push(k),
    };
    await drainMcpNotices(storage, async () => {}, () => NOW);
    return deleted;
  };
  it("noticeKeyTime はキーの時刻を取り出す", () => {
    expect(noticeKeyTime(makeNoticeKey(new Date(NOW), "a"))).toBe(NOW);
    expect(noticeKeyTime(`${MCP_NOTICE_PREFIX}zzz`)).toBeNull();
  });
  it("新しい null は残し、2 分より古い null は消す、時刻が取れないキーは消す", async () => {
    expect(await run(NOW - 10_000)).toEqual([]);
    expect(await run(NOW - MCP_NOTICE_NULL_GRACE_MS - 1000)).toHaveLength(1);
    expect(await run("bad")).toHaveLength(1);
  });
});

describe("recordMemoBacklinks", () => {
  const backlinks = { captureId: "m1", pages: [{ wikiId: "a", title: "A" }, { wikiId: "b", title: "B" }] };
  it("索引に無い captureId では何も呼ばない", async () => {
    const record = vi.fn(async () => {});
    expect(await recordMemoBacklinks(backlinks, () => false, record)).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
  it("索引にあれば wiki: 付きで全ページ記録する", async () => {
    const record = vi.fn(async () => {});
    expect(await recordMemoBacklinks(backlinks, (id) => id === "m1", record)).toBe(true);
    expect(record.mock.calls).toEqual([["m1", "wiki:a", "A"], ["m1", "wiki:b", "B"]]);
  });
});
