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

/** 本文で当たった箇所の抜粋（全文の索引から）。ranges は text の中の強調する範囲 */
export type BodyHit = { text: string; ranges: readonly { start: number; end: number }[] };
/** 記録の id → 本文で当たった箇所。全文の索引がまだ無いときは空 */
export type BodyHits = ReadonlyMap<string, BodyHit>;

/**
 * 全文の索引の抜粋を、記録の画面に出す形に整える。
 * 索引のチャンクは先頭に見出しを Markdown の形（"## 見出し"）で持つので、記号だけを外す
 */
export function tidyBodyHit(hit: BodyHit): BodyHit {
  const lead = /^#{1,6}\s+/.exec(hit.text);
  if (!lead) return hit;
  const shift = lead[0].length;
  return {
    text: hit.text.slice(shift),
    ranges: hit.ranges
      .map((r) => ({ start: Math.max(0, r.start - shift), end: Math.max(0, r.end - shift) }))
      .filter((r) => r.end > r.start),
  };
}

/**
 * 探す言葉に当たるか。題・メモの本文・題の下の 1 行・ドメイン（matchesQuery）に加えて、
 * 全文の索引で本文に当たった記録（bodyHits）も当たりにする
 */
export function isHit(item: RecordItem, query: string, bodyHits?: BodyHits): boolean {
  if (matchesQuery(item, query)) return true;
  return query.trim().length > 0 && !!bodyHits?.has(item.id);
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

// ── カレンダー ─────────────────────────────

/** 日（"2026-11-17"）ごとの件数。日時として読めない記録は数えない */
export function countByDay(items: readonly RecordItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = dayKeyOf(item.at);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** "2026-11-17" → "2026-11" */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7);
}

/** 月を前後に動かす。shiftMonth("2026-01", -1) → "2025-12" */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export type CalendarCell = { key: string; day: number } | null;

/** 月の表示の升目。週は日曜から始まり、月の外の升は null */
export function monthGrid(monthKey: string): CalendarCell[][] {
  const [y, m] = monthKey.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells: CalendarCell[] = Array.from({ length: first.getDay() }, () => null);
  for (let day = 1; day <= days; day++) cells.push({ key: `${monthKey}-${pad(day)}`, day });
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: CalendarCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * 件数を濃淡の段（0〜4）にする。0 件は 0。
 * 一括の取り込みで 1 日だけ何百件もある、という偏りがあるので、平方根で差をならす
 * （そのまま割ると、ほかの日がすべていちばん薄い段になる）。
 */
export function densityLevel(count: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0 || max <= 0) return 0;
  const ratio = Math.sqrt(count) / Math.sqrt(max);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** "2026年11月" / "November 2026" */
export function formatMonth(monthKey: string, locale: Locale): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(localeTag(locale), { year: "numeric", month: "long" }).format(new Date(y, m - 1, 1));
}

/** 曜日の見出し（日曜から）。"日" / "Sun" */
export function weekdayLabels(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(localeTag(locale), { weekday: "short" });
  // 2023-01-01 は日曜
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(2023, 0, 1 + i)));
}
