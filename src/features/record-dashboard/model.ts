// 記録の並べ方・絞り込み・探し方（表示のための純粋な関数）。
import type { RecordItem, RecordLocale, RecordOrigin, WhoFilter } from "./types";

export type RecordDayGroup = {
  /** "2026-11-17" */
  key: string;
  items: RecordItem[];
};

/** 記録を日ごとにまとめる。日は新しい順、日の中は時刻の早い順（1 日の流れとして読めるように） */
export function groupByDay(items: readonly RecordItem[]): RecordDayGroup[] {
  const map = new Map<string, RecordItem[]>();
  for (const item of items) {
    const key = item.at.slice(0, 10);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([key, list]) => ({ key, items: [...list].sort((a, b) => (a.at < b.at ? -1 : 1)) }));
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

/** "09:05" */
export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}

function localeTag(locale: RecordLocale): string {
  return locale === "ja" ? "ja-JP" : "en-US";
}

/** "11月17日" / "Nov 17" */
export function formatDate(dayKey: string, locale: RecordLocale): string {
  return new Intl.DateTimeFormat(localeTag(locale), { month: locale === "ja" ? "long" : "short", day: "numeric" }).format(
    new Date(`${dayKey}T00:00:00`),
  );
}

/** "火曜日" / "Tuesday" */
export function formatWeekday(dayKey: string, locale: RecordLocale, width: "long" | "short" = "long"): string {
  return new Intl.DateTimeFormat(localeTag(locale), { weekday: width }).format(new Date(`${dayKey}T00:00:00`));
}

/** now から見て何日前か（今日 = 0） */
export function daysAgo(dayKey: string, now: string): number {
  const a = new Date(`${dayKey}T00:00:00`).getTime();
  const b = new Date(`${now.slice(0, 10)}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** now までの 7 日分の日付（古い順）と、その日の件数 */
export function lastSevenDays(items: readonly RecordItem[], now: string): { key: string; count: number }[] {
  const base = new Date(`${now.slice(0, 10)}T00:00:00`);
  const out: { key: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ key, count: items.filter((it) => it.at.startsWith(key)).length });
  }
  return out;
}
