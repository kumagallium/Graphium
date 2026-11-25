// LP のボタンが指す先。ヒーローと「はじめる」で同じ値を使う
import type { Locale } from "./i18n";

export const DESKTOP_DOWNLOAD_URL = "https://github.com/kumagallium/Graphium/releases/latest";

/** 実験ノートの見本（features/demo）。束は言語ごとに分かれるので、LP の表示言語に合わせる */
export function labSampleHref(locale: Locale): string {
  return `/Graphium/app/?demo=${locale === "ja" ? "thermo-ja" : "thermo-en"}`;
}
