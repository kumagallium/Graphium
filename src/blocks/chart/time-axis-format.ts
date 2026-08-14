// 時間軸のラベル書式（純関数のみ）
//
// ECharts の time 軸は既定だと日境界の目盛りを日番号だけ（"14"）で描く。
// 時刻ラベル（"12:00"）に混じった数字が何の 14 なのか読み取れないので、
// 日境界には月日を、月境界には年月を出して単位を明示する。

import type { Locale } from "../../i18n";

/** ECharts time 軸の axisLabel.formatter（時間粒度ごとのテンプレート） */
export function timeAxisLabelFormatter(locale: Locale): Record<string, string> {
  const ja = locale === "ja";
  return {
    year: "{yyyy}",
    month: ja ? "{yyyy}/{M}" : "{MMM} {yyyy}",
    day: ja ? "{M}/{d}" : "{MMM} {d}",
    hour: "{HH}:{mm}",
    minute: "{HH}:{mm}",
    second: "{HH}:{mm}:{ss}",
    millisecond: "{HH}:{mm}:{ss}.{SSS}",
    // 目盛りが粒度に揃わないとき（none）は日付まで出さないと読めない
    none: ja ? "{yyyy}/{M}/{d} {HH}:{mm}" : "{yyyy}-{MM}-{dd} {HH}:{mm}",
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * ツールチップに出す完全な日時。
 * 目盛りラベルは粒度ごとに省略するが、ツールチップは 1 点の同定に使うので
 * 常に年月日と時分（秒があれば秒まで）を出す。
 */
export function formatFullDateTime(ms: number, locale: Locale): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const date =
    locale === "ja"
      ? `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sec = d.getSeconds() ? `:${pad(d.getSeconds())}` : "";
  // 00:00 ちょうど（日付だけのデータ）は時刻を出さない
  if (!sec && d.getHours() === 0 && d.getMinutes() === 0) return date;
  return `${date} ${time}${sec}`;
}
