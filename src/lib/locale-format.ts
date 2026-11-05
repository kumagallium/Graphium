// UI ロケールごとの書式の小さな対応表。
//
// ja / en 以外の UI ロケールを足したとき、`locale === "ja" ? … : …` の分岐で
// 英語側に落ちると困るもの（Intl に渡す言語タグ・一覧の並び順）をここに集める。

import type { Locale } from "../i18n";

const BCP47: Record<Locale, string> = {
  en: "en-US",
  ja: "ja-JP",
  ko: "ko-KR",
};

/** Intl / toLocale*String に渡す言語タグ */
export function toBcp47(locale: Locale): string {
  return BCP47[locale];
}

/**
 * 画面に出す一覧を名前順に並べるときの照合ロケール。
 *
 * 一覧はこれまで UI 言語に関係なく "ja" の照合で並べていた（英語 UI でも日本語の
 * タイトルを読みの順に並べるため）。ja / en ではその順を変えず、ko だけ韓国語の
 * 照合にする。MCP や内部処理の並び順はここを使わない。
 */
export function listCollationLocale(locale: Locale): string {
  return locale === "ko" ? "ko" : "ja";
}
