// 記録の並べ方・絞り込み・探し方（表示のための純粋な関数）。
// 日付と時刻は、端末の時刻で読む。実データの日時は UTC の ISO 文字列（末尾 Z）なので、
// 文字列を切り取ると日付の変わり目がずれる。
import type { Locale } from "../../i18n";
import type { RecordItem, RecordOrigin, WhoFilter } from "./types";

export type RecordDayGroup = {
  /** "2026-11-17"（端末の時刻での日付） */
  key: string;
  items: RecordItem[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function keyOfDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 並べるための時刻。日時として読めないものは、いちばん古い扱い */
export function timeOf(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** 端末の時刻での日付 "2026-11-17"。日時として読めないときは空文字 */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : keyOfDate(d);
}

/** 記録を日ごとにまとめる。日は新しい順、日の中は時刻の早い順（1 日の流れとして読めるように） */
export function groupByDay(items: readonly RecordItem[]): RecordDayGroup[] {
  const map = new Map<string, RecordItem[]>();
  for (const item of items) {
    const key = dayKeyOf(item.at);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => ({ key, items: [...list].sort((a, b) => timeOf(a.at) - timeOf(b.at)) }));
}

/** 探す言葉に当たるか。題・本文・題の下の 1 行・ドメインを見る */
export function matchesQuery(item: RecordItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.text, item.detail, item.domain].some((s) => s?.toLowerCase().includes(q));
}

/** 誰での絞り込み。「自分と AI」は自分にも AI にも当たる */
export function matchesWho(item: RecordItem, who: WhoFilter): boolean {
  if (who === "all") return true;
  if (who === "self") return item.who.type === "self" || item.who.type === "selfWithAi";
  if (who === "ai") return item.who.type === "ai" || item.who.type === "selfWithAi";
  return item.who.type === "other";
}

/** 出どころでの絞り込み。空の集合は「すべて」 */
export function matchesOrigin(item: RecordItem, origins: ReadonlySet<RecordOrigin>): boolean {
  return origins.size === 0 || origins.has(item.origin);
}

/** 出てくる出どころを、件数の多い順に数える */
export function countOrigins(items: readonly RecordItem[]): { origin: RecordOrigin; count: number }[] {
  const map = new Map<RecordOrigin, number>();
  for (const item of items) map.set(item.origin, (map.get(item.origin) ?? 0) + 1);
  return [...map.entries()].map(([origin, count]) => ({ origin, count })).sort((a, b) => b.count - a.count);
}

/** 端末の時刻での "09:05"。日時として読めないときは空文字 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LOCALE_TAG: Record<Locale, string> = { en: "en-US", ja: "ja-JP", ko: "ko-KR" };

function localeTag(locale: Locale): string {
  return LOCALE_TAG[locale] ?? "en-US";
}

/** "11月17日" / "Nov 17"。日付として読めないときは空文字 */
export function formatDate(dayKey: string, locale: Locale): string {
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag(locale), { month: locale === "en" ? "short" : "long", day: "numeric" }).format(d);
}

/** "火曜日" / "Tuesday"。日付として読めないときは空文字 */
export function formatWeekday(dayKey: string, locale: Locale, width: "long" | "short" = "long"): string {
  const d = new Date(`${dayKey}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: width }).format(d);
}

/** now から見て何日前か（今日 = 0） */
export function daysAgo(dayKey: string, now: string): number {
  const a = new Date(`${dayKey}T00:00:00`).getTime();
  const b = new Date(`${dayKeyOf(now)}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** now までの 7 日分の日付（古い順）と、その日の件数 */
export function lastSevenDays(items: readonly RecordItem[], now: string): { key: string; count: number }[] {
  const base = new Date(`${dayKeyOf(now)}T00:00:00`);
  const counts = new Map<string, number>();
  for (const it of items) {
    const key = dayKeyOf(it.at);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: { key: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const key = keyOfDate(d);
    out.push({ key, count: counts.get(key) ?? 0 });
  }
  return out;
}

/** 同じ種類・出どころ・残した人の記録が続いたところを 1 行にまとめたもの */
export type RecordBundle = {
  type: "bundle";
  /** まとめの先頭の記録の id から作る（開閉の状態の鍵） */
  id: string;
  items: RecordItem[];
};

export type RecordDayEntry = RecordItem | RecordBundle;

export function isBundle(entry: RecordDayEntry): entry is RecordBundle {
  return (entry as RecordBundle).type === "bundle";
}

/** これ以上続いたら 1 行にまとめる件数 */
export const BUNDLE_MIN = 6;

/**
 * 1 日の中で、同じ種類・出どころ・残した人の記録が min 件以上続いたところをまとめる。
 * 一括の取り込みやナレッジ化で 1 日に数百件が並ぶと、ほかの記録が埋もれるため。
 * 探す言葉に当たった記録はまとめない（keep が true を返した記録で列を切る）。
 */
export function bundleRuns(
  items: readonly RecordItem[],
  min: number = BUNDLE_MIN,
  keep: (item: RecordItem) => boolean = () => false,
): RecordDayEntry[] {
  if (min <= 1) return [...items];
  const out: RecordDayEntry[] = [];
  let run: RecordItem[] = [];
  let runKey = "";
  const flush = () => {
    if (run.length >= min) out.push({ type: "bundle", id: `bundle:${run[0].id}`, items: run });
    else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (keep(item)) {
      flush();
      runKey = "";
      out.push(item);
      continue;
    }
    const key = `${item.kind}|${item.origin}|${item.who.type}`;
    if (key !== runKey) {
      flush();
      runKey = key;
    }
    run.push(item);
  }
  flush();
  return out;
}

/**
 * 新しい日から順に、行の数が budget に収まるところまでの日数を返す（少なくとも 1 日）。
 * 何千件もの記録を一度に描かないための区切り。行の数は countRows で数える（まとめ行は 1 行）。
 */
export function daysWithinBudget(days: readonly RecordDayGroup[], budget: number, countRows: (day: RecordDayGroup) => number): number {
  let rows = 0;
  let n = 0;
  for (const day of days) {
    const next = rows + countRows(day);
    if (n > 0 && next > budget) break;
    rows = next;
    n++;
  }
  return n;
}
