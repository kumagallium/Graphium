// 拡大縮小の表示用の小さな部品（倍率の文字列・ショートカットの表記）

import { formatShortcut } from "../../lib/shortcut-label";

/** 0.9 → "90%"、0.67 → "67%" */
export function formatZoomPercent(level: number): string {
  return `${Math.round(level * 100)}%`;
}

/** 拡大・縮小・元に戻すのキー（表記の元。キーキャップにも使う） */
export const ZOOM_OUT_KEYS = ["mod", "-"] as const;
export const ZOOM_IN_KEYS = ["mod", "+"] as const;
export const ZOOM_RESET_KEYS = ["mod", "0"] as const;

/**
 * キーキャップに載せる字。縮小の「-」は短くて読みにくいので、表示だけ「−」（U+2212）にする
 * （判定するキーは変わらない。拡大の「+」と並べたとき同じ太さに見える）。
 */
export function zoomKeycapLabel(cap: string): string {
  return cap === "-" ? "−" : cap;
}

/**
 * 文言の {shortcut} に入れる「元に戻す」の表記（トーストは文の中なので文字列で見せる）。
 * 「⌘+0」「Ctrl+0」は読めるので、つなぎの「+」と区別がつかない拡大・縮小と違って文字列のままでよい。
 */
export function zoomResetShortcut(): string {
  return formatShortcut(ZOOM_RESET_KEYS, { macSeparator: "+" });
}
