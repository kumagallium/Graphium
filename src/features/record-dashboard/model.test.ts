import { describe, expect, it } from "vitest";
import {
  bundleRuns,
  countOrigins,
  dayKeyOf,
  daysAgo,
  daysWithinBudget,
  formatTime,
  groupByDay,
  isBundle,
  lastSevenDays,
  matchesOrigin,
  matchesQuery,
  matchesWho,
} from "./model";
import type { RecordItem } from "./types";

function rec(over: Partial<RecordItem> = {}): RecordItem {
  return { id: "r", kind: "note", at: "2026-11-17T09:05:00", origin: "written", who: { type: "self" }, title: "題", ...over };
}

/** 端末の時刻で作った日時を、実データと同じ UTC の ISO 文字列にする */
function utc(y: number, m: number, d: number, h: number, min: number): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

describe("日付と時刻は端末の時刻で読む", () => {
  it("UTC の ISO 文字列でも、端末の時刻の日付と時刻になる", () => {
    const at = utc(2026, 11, 17, 0, 30);
    expect(dayKeyOf(at)).toBe("2026-11-17");
    expect(formatTime(at)).toBe("00:30");
  });

  it("日時として読めないものは空文字にする", () => {
    expect(dayKeyOf("")).toBe("");
    expect(formatTime("x")).toBe("");
  });

  it("今日は 0、前の日は 1", () => {
    expect(daysAgo("2026-11-17", utc(2026, 11, 17, 23, 0))).toBe(0);
    expect(daysAgo("2026-11-16", utc(2026, 11, 17, 0, 10))).toBe(1);
  });
});

describe("groupByDay", () => {
  it("日は新しい順、日の中は早い順に並べる", () => {
    const groups = groupByDay([
      rec({ id: "a", at: utc(2026, 11, 16, 20, 0) }),
      rec({ id: "b", at: utc(2026, 11, 17, 21, 0) }),
      rec({ id: "c", at: utc(2026, 11, 17, 0, 5) }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-11-17", "2026-11-16"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["c", "b"]);
  });
});

describe("絞り込み", () => {
  it("探す言葉は、題・本文・題の下の 1 行・ドメインのどれかに当たればよい（大文字小文字は見ない）", () => {
    expect(matchesQuery(rec({ title: "Cold Proof" }), "cold")).toBe(true);
    expect(matchesQuery(rec({ title: undefined, text: "温度を下げる" }), "温度")).toBe(true);
    expect(matchesQuery(rec({ detail: "材料 · 手順" }), "手順")).toBe(true);
    expect(matchesQuery(rec({ domain: "bread.example" }), "bread")).toBe(true);
    expect(matchesQuery(rec(), "無い言葉")).toBe(false);
    expect(matchesQuery(rec(), "  ")).toBe(true);
  });

  it("「自分と AI」は、自分にも AI にも当たる", () => {
    const both = rec({ who: { type: "selfWithAi", model: "m" } });
    expect(matchesWho(both, "self")).toBe(true);
    expect(matchesWho(both, "ai")).toBe(true);
    expect(matchesWho(both, "other")).toBe(false);
    expect(matchesWho(rec({ who: { type: "other", name: "みなと" } }), "other")).toBe(true);
  });

  it("出どころを選んでいなければ、すべて通す", () => {
    expect(matchesOrigin(rec(), new Set())).toBe(true);
    expect(matchesOrigin(rec(), new Set(["phone"]))).toBe(false);
  });

  it("出どころを件数の多い順に数える", () => {
    const counts = countOrigins([rec({ origin: "memo" }), rec({ origin: "file" }), rec({ origin: "memo" })]);
    expect(counts).toEqual([
      { origin: "memo", count: 2 },
      { origin: "file", count: 1 },
    ]);
  });
});

describe("lastSevenDays", () => {
  it("今日までの 7 日を古い順に並べ、その日の件数を数える", () => {
    const days = lastSevenDays([rec({ at: utc(2026, 11, 17, 9, 0) }), rec({ at: utc(2026, 11, 14, 9, 0) })], utc(2026, 11, 17, 22, 0));
    expect(days.map((d) => d.key)).toEqual([
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
    ]);
    expect(days.map((d) => d.count)).toEqual([0, 0, 0, 1, 0, 0, 1]);
  });
});

describe("bundleRuns", () => {
  const run = (n: number, over: Partial<RecordItem> = {}) =>
    Array.from({ length: n }, (_, i) => rec({ id: `${over.kind ?? "note"}-${over.origin ?? "written"}-${i}`, ...over }));

  it("同じ種類・出どころ・残した人が 6 件以上続いたら 1 行にまとめる", () => {
    const wiki = run(7, { kind: "wiki", origin: "knowledge", who: { type: "ai" } });
    const out = bundleRuns([rec({ id: "first" }), ...wiki, rec({ id: "last" })]);
    expect(out).toHaveLength(3);
    expect(isBundle(out[1]) && out[1].items).toHaveLength(7);
    expect(isBundle(out[1]) && out[1].id).toBe("bundle:wiki-knowledge-0");
  });

  it("5 件までの並びはそのまま出す", () => {
    expect(bundleRuns(run(5)).some(isBundle)).toBe(false);
  });

  it("あいだに別の種類が入ったら、列を切る", () => {
    const a = run(4, { kind: "media", origin: "file" });
    const b = run(4, { kind: "media", origin: "file" }).map((r) => ({ ...r, id: `b-${r.id}` }));
    expect(bundleRuns([...a, rec({ id: "memo", kind: "memo", origin: "memo" }), ...b]).some(isBundle)).toBe(false);
  });

  it("探す言葉に当たった記録はまとめず、その前後で列を切る", () => {
    const items = run(13, { kind: "media", origin: "file" });
    const out = bundleRuns(items, 6, (r) => r.id === items[6].id);
    expect(out.map((e) => (isBundle(e) ? e.items.length : e.id))).toEqual([6, items[6].id, 6]);
  });

  it("渡した配列を書き換えない", () => {
    const items = Object.freeze(run(8));
    expect(() => bundleRuns(items)).not.toThrow();
  });
});

describe("daysWithinBudget", () => {
  const day = (key: string, n: number) => ({ key, items: Array.from({ length: n }, (_, i) => rec({ id: `${key}-${i}` })) });
  const rows = (d: { items: RecordItem[] }) => d.items.length;

  it("行の数が収まるところまでの日数を返す", () => {
    expect(daysWithinBudget([day("a", 40), day("b", 40), day("c", 40)], 100, rows)).toBe(2);
  });

  it("初めの日だけで超えても、1 日は出す", () => {
    expect(daysWithinBudget([day("a", 500), day("b", 1)], 100, rows)).toBe(1);
  });

  it("日が無ければ 0", () => {
    expect(daysWithinBudget([], 100, rows)).toBe(0);
  });
});
