// スマホで Graphium を開くための URL を決める。
//
// モバイル送信の接続（OAuth）は**スマホ側でしか意味がない**（トークンは端末ごとの
// localStorage）。デスクトップ設定はその入口を QR で渡すだけなので、「スマホの
// ブラウザで開ける URL」が必要になる。
//
// 決め方は 2 通り:
//   1. web で開いている場合 — いま配信されている場所から組み立てる
//      （origin + BASE_URL + "app/"）。GitHub Pages でも、セルフホスト（Docker）でも
//      LAN 上の実 URL になるので、そのまま同じ LAN のスマホから開ける。
//   2. デスクトップアプリ（Tauri）の場合 — location は tauri://localhost などで
//      外から開けないため、公開配布 URL の定数に落とす。
//
// 疎結合: platform 判定以外に依存しない（inbox/config.ts と同じ独立ヘルパー形）。

import { isTauri } from "../../../lib/platform";

/** 公開配布されている Graphium アプリ（GitHub Pages）。Tauri から QR を出すときの既定。 */
export const GRAPHIUM_PUBLIC_APP_URL = "https://kumagallium.github.io/Graphium/app/";

/**
 * スマホで開くべき Graphium アプリの URL。
 * web は自分の配信元から、デスクトップアプリは公開 URL から。
 */
export function getMobileAppUrl(): string {
  if (!isTauri() && typeof window !== "undefined" && window.location) {
    const origin = window.location.origin;
    // about:blank / tauri: など http(s) でない配信元は QR にしても開けない
    if (origin.startsWith("http://") || origin.startsWith("https://")) {
      const base =
        typeof import.meta !== "undefined" && import.meta.env?.BASE_URL
          ? import.meta.env.BASE_URL
          : "/";
      try {
        return new URL(`${base}app/`, origin).toString();
      } catch {
        // URL 組み立てに失敗したら公開 URL に落とす
      }
    }
  }
  return GRAPHIUM_PUBLIC_APP_URL;
}
