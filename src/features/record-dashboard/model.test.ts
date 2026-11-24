import { describe, expect, it } from "vitest";
import {
  bundleRuns,
  countByDay,
  countOrigins,
  dayKeyOf,
  daysAgo,
  daysWithinBudget,
  densityLevel,
  formatTime,
  groupByDay,
  isBundle,
  isHit,
  lastSevenDays,
  matchesFolder,
  matchesOrigin,
  matchesQuery,
  summarizeFolders,
  matchesWho,
  planRowText,
  tidyBodyHit,
  monthGrid,
  monthKeyOf,
  shiftMonth,
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

  it("「すべて」には、共有フォルダにほかの人が出した記録を混ぜない", () => {
    const shared = rec({ origin: "shared", who: { type: "other", name: "みなと" } });
    expect(matchesWho(shared, "all")).toBe(false);
    expect(matchesWho(shared, "self")).toBe(false);
    expect(matchesWho(shared, "ai")).toBe(false);
    expect(matchesWho(rec(), "all")).toBe(true);
    expect(matchesWho(rec({ who: { type: "ai" } }), "all")).toBe(true);
  });

  it("共有フォルダの記録は、作者の名前と、計画の題・行の名前でも当たる", () => {
    const shared = rec({
      origin: "shared",
      who: { type: "other", name: "佐藤 花" },
      title: "一次発酵の記録",
      planRow: { planTitle: "食パンの計画", rowName: "一次発酵" },
    });
    expect(matchesQuery(shared, "佐藤")).toBe(true);
    expect(matchesQuery(shared, "食パン")).toBe(true);
    expect(matchesQuery(shared, "発酵")).toBe(true);
    expect(matchesQuery(shared, "カレー")).toBe(false);
    expect(planRowText(shared)).toBe("食パンの計画 › 一次発酵");
    expect(planRowText(rec({ planRow: { rowName: "焼成" } }))).toBe("焼成");
    expect(planRowText(rec())).toBe("");
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

  it("共有フォルダの記録は作者ごとにまとめる（別の作者が続いても 1 行にしない）", () => {
    const by = (name: string, n: number) =>
      Array.from({ length: n }, (_, i) => rec({ id: `${name}-${i}`, origin: "shared", who: { type: "other", name } }));
    expect(bundleRuns([...by("佐藤", 3), ...by("田中", 3)]).some(isBundle)).toBe(false);
    const out = bundleRuns(by("佐藤", 7));
    expect(out).toHaveLength(1);
    expect(isBundle(out[0]) && out[0].items).toHaveLength(7);
  });

  it("計画の行の記録はまとめず、その前後で列を切る", () => {
    const items = Array.from({ length: 13 }, (_, i) =>
      rec({ id: `s-${i}`, origin: "shared", who: { type: "other", name: "佐藤" }, ...(i === 6 ? { planRow: { rowName: "焼成" } } : {}) }),
    );
    expect(bundleRuns(items).map((e) => (isBundle(e) ? e.items.length : e.id))).toEqual([6, "s-6", 6]);
    const rows = items.map((r) => ({ ...r, planRow: { rowName: "こね" } }));
    expect(bundleRuns(rows).some(isBundle)).toBe(false);
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

describe("isHit（題・本文に加えて、全文の索引で本文に当たった記録）", () => {
  const hits = new Map([["r", { text: "こね上げ温度は 24 度", ranges: [{ start: 0, end: 3 }] }]]);

  it("題で当たる", () => {
    expect(isHit(rec({ title: "食パン 試作" }), "食パン")).toBe(true);
  });

  it("題に無くても、本文で当たった記録は当たりになる", () => {
    expect(isHit(rec({ title: "食パン 試作" }), "こね上げ", hits)).toBe(true);
  });

  it("探す言葉が空なら、bodyHits があっても matchesQuery と同じ（全部当たる）", () => {
    expect(isHit(rec(), "", hits)).toBe(matchesQuery(rec(), ""));
    expect(isHit(rec(), "  ", hits)).toBe(matchesQuery(rec(), "  "));
  });

  it("どちらにも無ければ当たらない", () => {
    expect(isHit(rec({ title: "食パン 試作" }), "こね上げ")).toBe(false);
    expect(isHit(rec({ id: "other", title: "食パン 試作" }), "こね上げ", hits)).toBe(false);
  });
});

describe("tidyBodyHit", () => {
  it("先頭の見出し記号を外し、強調の範囲をずらす", () => {
    const hit = { text: "## 試す順番 温度はそのまま", ranges: [{ start: 8, end: 10 }] };
    expect(tidyBodyHit(hit)).toEqual({ text: "試す順番 温度はそのまま", ranges: [{ start: 5, end: 7 }] });
  });
  it("見出し記号で始まらない抜粋はそのまま返す", () => {
    const hit = { text: "…発酵の温度を先に", ranges: [{ start: 4, end: 6 }] };
    expect(tidyBodyHit(hit)).toBe(hit);
  });
});

describe("カレンダー", () => {
  it("日ごとの件数を数える。日時として読めない記録は数えない", () => {
    const counts = countByDay([rec({ at: utc(2026, 11, 17, 9, 0) }), rec({ at: utc(2026, 11, 17, 23, 30) }), rec({ at: utc(2026, 11, 3, 0, 5) }), rec({ at: "" })]);
    expect([...counts.entries()].sort()).toEqual([
      ["2026-11-03", 1],
      ["2026-11-17", 2],
    ]);
  });

  it("月を前後に動かす（年をまたぐ）", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", 0)).toBe("2026-11");
    expect(monthKeyOf("2026-11-17")).toBe("2026-11");
  });

  it("月の升目は日曜から始まり、月の外は null で埋める", () => {
    // 2026 年 11 月 1 日は日曜、30 日まで
    const nov = monthGrid("2026-11");
    expect(nov).toHaveLength(5);
    expect(nov[0][0]).toEqual({ key: "2026-11-01", day: 1 });
    expect(nov[4][1]).toEqual({ key: "2026-11-30", day: 30 });
    expect(nov[4].slice(2)).toEqual([null, null, null, null, null]);
    // 2026 年 10 月 1 日は木曜
    const oct = monthGrid("2026-10");
    expect(oct[0].slice(0, 4)).toEqual([null, null, null, null]);
    expect(oct[0][4]).toEqual({ key: "2026-10-01", day: 1 });
    expect(oct.every((w) => w.length === 7)).toBe(true);
  });

  it("うるう年の 2 月は 29 日まで", () => {
    const days = monthGrid("2028-02").flat().filter(Boolean);
    expect(days).toHaveLength(29);
  });

  it("件数を濃淡の段にする。1 日だけ飛び抜けて多くても、ほかの日がつぶれない", () => {
    expect(densityLevel(0, 592)).toBe(0);
    expect(densityLevel(3, 0)).toBe(0);
    expect(densityLevel(592, 592)).toBe(4);
    expect(densityLevel(2, 592)).toBe(1);
    expect(densityLevel(60, 592)).toBe(2);
    expect(densityLevel(200, 592)).toBe(3);
    expect(densityLevel(1, 1)).toBe(4);
  });
});

describe("summarizeFolders", () => {
  const item = (id: string, at: string, extra: Partial<RecordItem> = {}): RecordItem => ({
    id, kind: "note", at, origin: "written", who: { type: "self" }, title: id, ...extra,
  });

  it("新しく動いたフォルダを上に、フォルダなしを最後に並べる", () => {
    const out = summarizeFolders([
      item("a", "2026-11-10T10:00:00", { folders: ["古い"] }),
      item("b", "2026-11-17T09:00:00"),
      item("c", "2026-11-16T10:00:00", { folders: ["新しい"] }),
    ]);
    expect(out.map((f) => f.name)).toEqual(["新しい", "古い", null]);
  });

  it("複数のフォルダに入っている記録は、それぞれで数える。大文字・小文字の違いは同じフォルダ", () => {
    const out = summarizeFolders([
      item("a", "2026-11-17T10:00:00", { folders: ["Bread", "Class"] }),
      item("b", "2026-11-16T10:00:00", { folders: ["bread"] }),
    ]);
    expect(out.find((f) => f.name === "Bread")).toEqual({ name: "Bread", count: 2, lastAt: "2026-11-17T10:00:00" });
    expect(out.find((f) => f.name === "Class")?.count).toBe(1);
    expect(out).toHaveLength(2);
  });
});

describe("matchesFolder", () => {
  const it0: RecordItem = { id: "a", kind: "memo", at: "2026-11-17T10:00:00", origin: "memo", who: { type: "self" }, folders: ["Bread"] };
  it("名前は大文字・小文字を区別しない。null はフォルダなし", () => {
    expect(matchesFolder(it0, "bread")).toBe(true);
    expect(matchesFolder(it0, "curry")).toBe(false);
    expect(matchesFolder(it0, null)).toBe(false);
    expect(matchesFolder({ ...it0, folders: undefined }, null)).toBe(true);
  });
});
