// チャートの配色・テーマ
//
// 系列色は design.md「手順フロービュー」の 4 色（flow-palette.ts の KIND_PALETTE）
// と同値。チャート系列は PROV の意味（activity/material/…）を持たないため、
// モジュール依存は作らず値だけを共有する。5 系列以上は同じ 4 色の明るい変種で
// ローテーションする。
// UI ニュートラル色（文字・罫線）は CSS トークンから実行時に読む。

export const CHART_SERIES_COLORS = [
  "#5b8fb9", // 青（activity）
  "#4B7A52", // 緑（material）
  "#c08b3e", // 黄土（tool）
  "#c26356", // 赤茶（output）
  "#8fb3d1", // 以下、明るい変種
  "#7da283",
  "#d4af76",
  "#d69287",
];

export type ChartUiColors = {
  text: string;
  line: string;
};

/** CSS トークンから文字・罫線色を読む（SVG 内は CSS 変数を解決できないため実値化） */
export function readChartUiColors(): ChartUiColors {
  if (typeof window === "undefined") return { text: "#666", line: "#ddd" };
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    text: read("--color-text-secondary", "#666"),
    line: read("--color-border-subtle", "#ddd"),
  };
}
