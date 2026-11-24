import { describe, expect, it } from "vitest";
import {
  isSafePageId,
  makeNoticeKey,
  MCP_LIVE_FORMAT_VERSION,
  MCP_NOTICE_MAX_PAGES,
  MCP_NOTICE_PREFIX,
  parseNotice,
  parseOpenPages,
} from "./format";

const AT = "2026-11-24T01:02:03.000Z";
const notice = (over: Record<string, unknown> = {}) => ({
  formatVersion: MCP_LIVE_FORMAT_VERSION,
  at: AT,
  pages: [{ wikiId: "abc", title: "題", created: true }],
  ...over,
});

describe("isSafePageId", () => {
  it("通常の id は通し、区切り・親ディレクトリ・空・長すぎ・非文字列は断る", () => {
    expect(isSafePageId("a1-b2_c3")).toBe(true);
    for (const bad of ["", "a/b", "a\\b", "..", "a..b", "x".repeat(201), 1, null, undefined]) {
      expect(isSafePageId(bad)).toBe(false);
    }
  });
});

describe("isSafePageId（厳格化）", () => {
  it("英数字・_・-・. 以外、先頭末尾の . 、Windows の予約名は断る", () => {
    expect(isSafePageId("a.b")).toBe(true);
    expect(isSafePageId("console")).toBe(true);
    for (const bad of ["a b", "日本語", "a:b", "a\u0000b", ".hidden", "trail.", "CON", "nul", "com1", "LPT9.txt", "aux.json"]) {
      expect(isSafePageId(bad)).toBe(false);
    }
  });
});

describe("parseOpenPages busy / parseNotice now", () => {
  it("busy は true のときだけ引き継ぐ（古い形のファイルも読める）", () => {
    expect(parseOpenPages({ formatVersion: 1, at: AT, wikiIds: [], busy: true })?.busy).toBe(true);
    expect(parseOpenPages({ formatVersion: 1, at: AT, wikiIds: [], busy: "yes" })).not.toHaveProperty("busy");
    expect(parseOpenPages({ formatVersion: 1, at: AT, wikiIds: [] })).not.toHaveProperty("busy");
  });
  it("now を渡すと、未来すぎる時刻の知らせを断る（1 分までのずれは許す）", () => {
    const now = Date.parse(AT);
    expect(parseNotice(notice(), now + 30_000)).not.toBeNull();
    expect(parseNotice(notice({ at: new Date(now + 30_000).toISOString() }), now)).not.toBeNull();
    expect(parseNotice(notice({ at: new Date(now + 61_000).toISOString() }), now)).toBeNull();
  });
});

describe("makeNoticeKey", () => {
  it("接頭辞つきで時刻順に並び、id の記号は落とす", () => {
    const a = makeNoticeKey(new Date("2026-11-24T01:00:00.000Z"), "x-y");
    const b = makeNoticeKey(new Date("2026-11-24T01:00:01.000Z"), "a");
    expect(a.startsWith(MCP_NOTICE_PREFIX)).toBe(true);
    expect(a.endsWith("-xy")).toBe(true);
    expect([b, a].sort()).toEqual([a, b]);
  });
});

describe("parseOpenPages", () => {
  it("正常な一覧を読み、重複を除く", () => {
    const r = parseOpenPages({ formatVersion: 1, at: AT, wikiIds: ["a", "b", "a"] });
    expect(r?.wikiIds).toEqual(["a", "b"]);
  });
  it("版違い・時刻不正・配列でない・不正 id を含むものは null", () => {
    expect(parseOpenPages({ formatVersion: 2, at: AT, wikiIds: [] })).toBeNull();
    expect(parseOpenPages({ formatVersion: 1, at: "x", wikiIds: [] })).toBeNull();
    expect(parseOpenPages({ formatVersion: 1, at: AT, wikiIds: "a" })).toBeNull();
    expect(parseOpenPages({ formatVersion: 1, at: AT, wikiIds: ["../x"] })).toBeNull();
    expect(parseOpenPages(null)).toBeNull();
    expect(parseOpenPages([])).toBeNull();
  });
});

describe("parseNotice", () => {
  it("正常な知らせを読む（created は true のときだけ true・題は切り詰める）", () => {
    const r = parseNotice(notice({ client: "c", pages: [{ wikiId: "a", title: "x".repeat(600) }] }));
    expect(r?.client).toBe("c");
    expect(r?.pages[0].created).toBe(false);
    expect(r?.pages[0].title).toHaveLength(500);
  });
  it("メモの逆リンクを読む・不正なら null", () => {
    const ok = parseNotice(notice({ memoBacklinks: { captureId: "m1", pages: [{ wikiId: "a", title: "t" }] } }));
    expect(ok?.memoBacklinks?.captureId).toBe("m1");
    expect(parseNotice(notice({ memoBacklinks: { captureId: "../m", pages: [] } }))).toBeNull();
    expect(parseNotice(notice({ memoBacklinks: { captureId: "m", pages: [{ wikiId: "a/b", title: "t" }] } }))).toBeNull();
  });
  it("形違い・id 不正・題が文字でない・上限超えは null", () => {
    expect(parseNotice(notice({ formatVersion: 9 }))).toBeNull();
    expect(parseNotice(notice({ at: "bad" }))).toBeNull();
    expect(parseNotice(notice({ pages: [{ wikiId: "../a", title: "t" }] }))).toBeNull();
    expect(parseNotice(notice({ pages: [{ wikiId: "a", title: 1 }] }))).toBeNull();
    const many = Array.from({ length: MCP_NOTICE_MAX_PAGES + 1 }, (_, i) => ({ wikiId: `p${i}`, title: "t" }));
    expect(parseNotice(notice({ pages: many }))).toBeNull();
    const max = many.slice(0, MCP_NOTICE_MAX_PAGES);
    expect(parseNotice(notice({ pages: max }))?.pages).toHaveLength(MCP_NOTICE_MAX_PAGES);
  });
});
