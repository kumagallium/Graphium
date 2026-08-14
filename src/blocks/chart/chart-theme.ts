// チャートの配色・学術スタイル定数
//
// 見た目は eureco のチャート（作者のこだわり: 学術分野でも違和感が少ない形）に
// 合わせる。eureco の実機 ECharts option から採った実測値:
//   - プロット領域: 黒 2px の全周枠（grid.show, z:10 で系列より上に描く）
//   - 軸線: 黒 1.5px / 目盛り: 内向き 8px（tick-inside は論文図の作法）
//   - グリッド線: 既定オフ（オンにする場合は 0.8px の破線）
//   - フォント: 16px #3F3F3F / 凡例: 左上・横並び・横長マーカー 50×14
//   - アスペクト比: √2:1（A 判用紙の比率）+ 図の下にキャプション
//
// 系列色は Tailwind 600 系（eureco 実測: red-600 / blue-600）。
// design.md の区分では「意味を持つ配色（グラフ系列色）」なので実値 hex が正しい
// （UI ニュートラルは CSS トークンを使う）。

export const CHART_SERIES_COLORS = [
  "#DC2626", // red-600（eureco 実測）
  "#2563EB", // blue-600（eureco 実測）
  "#16A34A", // green-600
  "#9333EA", // purple-600
  "#EA580C", // orange-600
  "#0891B2", // cyan-600
  "#CA8A04", // yellow-600
  "#DB2777", // pink-600
];

// 紙面（チャート内部）の色。ライトな「論文の図」として固定し、
// アプリテーマの変動を持ち込まない
export const CHART_INK = "#3F3F3F"; // 文字
export const CHART_FRAME = "#000000"; // 枠・軸線

export const CHART_FONT_SIZE = 16;

// プロット枠（eureco: borderWidth 2, z 10）
export const CHART_FRAME_WIDTH = 2;
// 軸線（eureco: 1.5px）
export const CHART_AXIS_LINE_WIDTH = 1.5;
// 目盛り（eureco: 内向き 8px）
export const CHART_TICK_LENGTH = 8;
// グリッド線（eureco: 0.8px dashed）
export const CHART_GRID_LINE = { width: 0.8, type: "dashed" as const };

// 凡例マーカー（eureco: 横長 50×14）
export const CHART_LEGEND_ITEM = { width: 50, height: 14 };

// ── 系列スタイルの段階プリセット ──
// 見た目は「細/中/太」「小/中/大」の 3 段階で選ばせ、実寸はここに集約する。
// px を直接入力させないのは、学術図としての見え方（線とマーカーの比）を
// 壊さないため。medium は既存ノートの見た目と一致させてあるので、
// 値を動かすと過去のノートの図が変わる点に注意。

/** 折れ線の線幅（medium = 従来の 2px） */
export const CHART_LINE_WIDTHS = { thin: 1, medium: 2, thick: 3 } as const;

/**
 * マーカーの径。折れ線は線が主役なので小さめ、散布図は点が主役なので大きめ
 *（medium = 従来の line 7px / scatter 10px）。
 */
export const CHART_SYMBOL_SIZES = {
  line: { small: 5, medium: 7, large: 10 },
  scatter: { small: 7, medium: 10, large: 14 },
} as const;

/** 棒の幅（カテゴリ幅に対する比）。auto は ECharts の自動配分に任せる */
export const CHART_BAR_WIDTHS = { narrow: "30%", medium: "50%", wide: "80%" } as const;

/**
 * アスペクト比（幅 ÷ 高さ）。standard は A 判の √2:1。
 * 4:1 / 5:1 は XRD・各種スペクトルのような横長パターン向け。
 */
export const CHART_ASPECT_RATIOS = {
  standard: Math.SQRT2,
  golden: (1 + Math.sqrt(5)) / 2,
  wide: 2,
  panorama: 3,
  ultrawide: 4,
  spectrum: 5,
  square: 1,
} as const;

export type ChartAspect = keyof typeof CHART_ASPECT_RATIOS;
