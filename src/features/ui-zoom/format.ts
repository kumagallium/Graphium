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
 * 文言の {zoomOut} / {zoomIn} / {reset} に入れる表記。
 * 拡大は「+」と書く（JIS 配列の「+」は Shift + ; だが、; だけでも効くようにしてある）。
 * 「=」と書くと JIS の利用者が Shift なしの Ctrl + = を探して縮小してしまう。
 */
export function zoomShortcutParams(): { zoomOut: string; zoomIn: string; reset: string } {
  const opts = { macSeparator: "+" };
  return {
    zoomOut: formatShortcut(ZOOM_OUT_KEYS, opts),
    zoomIn: formatShortcut(ZOOM_IN_KEYS, opts),
    reset: formatShortcut(ZOOM_RESET_KEYS, opts),
  };
}
