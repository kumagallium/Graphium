import { describe, expect, it, vi } from "vitest";
import { MCP_LIVE_FORMAT_VERSION, MCP_NOTICE_PREFIX, makeNoticeKey } from "./format";
import { drainMcpNotices, MCP_NOTICE_MAX_AGE_MS, type McpNoticeStorage } from "./notices";

const NOW = Date.parse("2026-11-24T12:00:00.000Z");

function makeStorage(initial: Record<string, unknown>) {
  const data = new Map(Object.entries(initial));
  const storage: McpNoticeStorage = {
    listAppDataKeys: async (p) => [...data.keys()].filter((k) => k.startsWith(p)),
    readAppData: async (k) => data.get(k) ?? null,
    deleteAppData: async (k) => {
      data.delete(k);
    },
  };
  return { data, storage };
}

const body = (id: string, at: string) => ({
  formatVersion: MCP_LIVE_FORMAT_VERSION,
  at,
  pages: [{ wikiId: id, title: id, created: false }],
});
const keyAt = (iso: string, id: string) => makeNoticeKey(new Date(iso), id);

describe("drainMcpNotices", () => {
  it("昇順に 1 件ずつ処理して消し、処理した件数を返す", async () => {
    const k1 = keyAt("2026-11-24T11:00:00.000Z", "a");
    const k2 = keyAt("2026-11-24T11:30:00.000Z", "b");
    const { data, storage } = makeStorage({
      [k2]: body("b", "2026-11-24T11:30:00.000Z"),
      [k1]: body("a", "2026-11-24T11:00:00.000Z"),
      "other-key": { x: 1 },
    });
    const seen: string[] = [];
    const n = await drainMcpNotices(storage, async (nt) => void seen.push(nt.pages[0].wikiId), () => NOW);
    expect(seen).toEqual(["a", "b"]);
    expect(n).toBe(2);
    expect([...data.keys()]).toEqual(["other-key"]);
  });

  it("形が違う知らせは handle せずに捨てる", async () => {
    const k = `${MCP_NOTICE_PREFIX}broken`;
    const { data, storage } = makeStorage({ [k]: { formatVersion: 99 } });
    const handle = vi.fn(async () => {});
    expect(await drainMcpNotices(storage, handle, () => NOW)).toBe(0);
    expect(handle).not.toHaveBeenCalled();
    expect(data.has(k)).toBe(false);
  });

  it("handle が失敗した知らせは残し、次の知らせへ進む", async () => {
    const k1 = keyAt("2026-11-24T11:00:00.000Z", "a");
    const k2 = keyAt("2026-11-24T11:30:00.000Z", "b");
    const { data, storage } = makeStorage({
      [k1]: body("a", "2026-11-24T11:00:00.000Z"),
      [k2]: body("b", "2026-11-24T11:30:00.000Z"),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const n = await drainMcpNotices(
      storage,
      async (nt) => {
        if (nt.pages[0].wikiId === "a") throw new Error("boom");
      },
      () => NOW,
    );
    warn.mockRestore();
    expect(n).toBe(1);
    expect(data.has(k1)).toBe(true);
    expect(data.has(k2)).toBe(false);
  });

  it("失敗し続けても 24 時間より古い知らせは捨てる", async () => {
    const oldAt = new Date(NOW - MCP_NOTICE_MAX_AGE_MS - 1000).toISOString();
    const k = keyAt(oldAt, "a");
    const { data, storage } = makeStorage({ [k]: body("a", oldAt) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const n = await drainMcpNotices(storage, async () => { throw new Error("boom"); }, () => NOW);
    warn.mockRestore();
    expect(n).toBe(0);
    expect(data.has(k)).toBe(false);
  });
});
