// 公開マニュアル（GitHub Pages）の URL。同梱マニュアルの節の URL もここを起点に組む。
// 本体（note-app）が静的に読むので、マニュアル本文（遅延読み込み）とは別のファイルに置く。

export const MANUAL_BASE_URL = "https://kumagallium.github.io/Graphium/manual/";

/** マニュアルの入口。日本語の UI なら日本語版、それ以外は英語版（韓国語のマニュアルは無い） */
export function manualHomeUrl(locale: string): string {
  return locale === "ja" ? `${MANUAL_BASE_URL}ja/` : MANUAL_BASE_URL;
}
