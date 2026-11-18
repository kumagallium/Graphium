// 絞り込み専用の「厳密な数値」の判定
//
// チャートが使う parseNumeric は先頭の数値部分だけを読むので、日付や版番号まで数値になる
// （`2024-01-05` が 2024、`3.5.2` が 3.5）。絞り込みでそれをやると、`date = 2024-01-05` が
// 2024 年の全行に一致してしまう。ここでは、数値部分の後ろに残るものが「空」か「単位らしい
// 文字だけ」のときに限って数値とみなす。

import { matchNumericPrefix, normalizeNumericText } from "../../blocks/chart/chart-data";

/** 数値の後ろに残ってよいのは、数字や区切り（- . : /）を含まない文字だけ（単位・%） */
const NOT_UNIT = /[0-9\-.:/]/;

/**
 * セルを数値として読む。読めなければ null。
 * `12 g` `0.4 mm` `35%` `-3.2e5` `1,234.5` は数値、`2024-01-05` `3.5.2` `12:30` `1/2` `10-20` は数値でない
 */
export function strictNumeric(raw: string): number | null {
  const s = normalizeNumericText(raw);
  if (!s) return null;
  const prefix = matchNumericPrefix(s);
  if (prefix === null) return null;
  const rest = s.slice(prefix.length).trim();
  if (rest !== "" && NOT_UNIT.test(rest)) return null;
  const n = Number(prefix);
  return Number.isFinite(n) ? n : null;
}
