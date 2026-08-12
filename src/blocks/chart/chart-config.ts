// チャートブロックの設定（props.config に JSON で保存する全体設定）
//
// BlockNote の propSchema は primitive しか持てないため、設定一式を 1 つの
// JSON 文字列として保存する。ここで型とデフォルト・パースを一元管理し、
// 欠けたフィールドは常にデフォルトで埋める（後からフィールドを足しても
// 旧ノートが壊れない）。

import type { ChartType, XAxisKind } from "./chart-data";
import { CHART_ASPECT_RATIOS, type ChartAspect } from "./chart-theme";

/** X 軸の目盛りの種類。auto は列の値から推定する */
export type XAxisKindSetting = "auto" | XAxisKind;

/**
 * 凡例の位置。
 * top-left / top-right はプロット枠の上（枠の左右端に揃える）。
 * inside-* はプロット枠の中の四隅。bottom は図の下・中央。
 */
export type LegendPosition =
  | "top-left"
  | "top-right"
  | "bottom"
  | "inside-top-left"
  | "inside-top-right"
  | "inside-bottom-left"
  | "inside-bottom-right";

export type LegendOrient = "horizontal" | "vertical";

export type SeriesAxis = "left" | "right";

/** 系列ごとの個別設定（キーは列名） */
export type SeriesOptions = {
  /** 凡例・ツールチップの表示名。空なら列名 */
  label?: string;
  /** 系列色。未指定はパレット順 */
  color?: string;
  /** 割り当てる Y 軸。既定は left。right を使うと第 2 軸が現れる */
  axis?: SeriesAxis;
};

export type ChartBlockConfig = {
  chartType: ChartType;
  /** X 軸に使う列名（histogram では対象の数値列） */
  xColumn: string;
  /** 系列にする列名（順序 = 描画順・凡例順） */
  yColumns: string[];
  /** 系列ごとの個別設定（列名 → オプション） */
  seriesOptions: Record<string, SeriesOptions>;
  /** 図の下に表示するキャプション（論文の Figure caption 相当） */
  caption: string;
  /** 軸名。空なら列名から自動 */
  xAxisName: string;
  yAxisName: string;
  /** X 軸の目盛りの種類（auto = 値から推定）。棒・分布ではカテゴリ固定 */
  xAxisKind: XAxisKindSetting;
  /** X 軸の最小/最大。空文字 = 自動。時間軸は日時文字列、数値軸は数値で解釈 */
  xMin: string;
  xMax: string;
  /** 左 Y 軸の最小/最大。空文字 = 自動 */
  yMin: string;
  yMax: string;
  /** 右 Y 軸（第 2 軸）。right に割り当てた系列があるときだけ使われる */
  yRightAxisName: string;
  yRightMin: string;
  yRightMax: string;
  aspect: ChartAspect;
  showLegend: boolean;
  legendPosition: LegendPosition;
  legendOrient: LegendOrient;
  /** プロット領域の全周枠（黒 box） */
  showFrame: boolean;
  /** グリッド線（splitLine, 破線）。X = 縦線、Y = 横線 */
  showGridX: boolean;
  showGridY: boolean;
};

export const DEFAULT_CHART_CONFIG: ChartBlockConfig = {
  chartType: "line",
  xColumn: "",
  yColumns: [],
  seriesOptions: {},
  caption: "",
  xAxisName: "",
  yAxisName: "",
  xAxisKind: "auto",
  xMin: "",
  xMax: "",
  yMin: "",
  yMax: "",
  yRightAxisName: "",
  yRightMin: "",
  yRightMax: "",
  aspect: "standard",
  showLegend: true,
  legendPosition: "top-left",
  legendOrient: "horizontal",
  showFrame: true,
  showGridX: false,
  showGridY: false,
};

const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "histogram"];
const LEGEND_POSITIONS: LegendPosition[] = [
  "top-left",
  "top-right",
  "bottom",
  "inside-top-left",
  "inside-top-right",
  "inside-bottom-left",
  "inside-bottom-right",
];

function parseSeriesOptions(raw: unknown): Record<string, SeriesOptions> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, SeriesOptions> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as any;
    const entry: SeriesOptions = {};
    if (typeof v.label === "string" && v.label.trim() !== "") entry.label = v.label;
    if (typeof v.color === "string" && v.color.trim() !== "") entry.color = v.color;
    if (v.axis === "right") entry.axis = "right";
    if (Object.keys(entry).length > 0) out[key] = entry;
  }
  return out;
}

export function parseChartBlockConfig(raw: string): ChartBlockConfig {
  let parsed: any = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  if (typeof parsed !== "object" || parsed === null) parsed = {};
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  return {
    chartType: CHART_TYPES.includes(parsed.chartType) ? parsed.chartType : DEFAULT_CHART_CONFIG.chartType,
    xColumn: str(parsed.xColumn, ""),
    yColumns: Array.isArray(parsed.yColumns)
      ? parsed.yColumns.filter((v: unknown) => typeof v === "string")
      : [],
    seriesOptions: parseSeriesOptions(parsed.seriesOptions),
    caption: str(parsed.caption, ""),
    xAxisName: str(parsed.xAxisName, ""),
    yAxisName: str(parsed.yAxisName, ""),
    xAxisKind: ["auto", "category", "value", "time"].includes(parsed.xAxisKind)
      ? parsed.xAxisKind
      : "auto",
    xMin: str(parsed.xMin, ""),
    xMax: str(parsed.xMax, ""),
    yMin: str(parsed.yMin, ""),
    yMax: str(parsed.yMax, ""),
    yRightAxisName: str(parsed.yRightAxisName, ""),
    yRightMin: str(parsed.yRightMin, ""),
    yRightMax: str(parsed.yRightMax, ""),
    aspect: parsed.aspect in CHART_ASPECT_RATIOS ? parsed.aspect : DEFAULT_CHART_CONFIG.aspect,
    showLegend: bool(parsed.showLegend, DEFAULT_CHART_CONFIG.showLegend),
    legendPosition: LEGEND_POSITIONS.includes(parsed.legendPosition)
      ? parsed.legendPosition
      : DEFAULT_CHART_CONFIG.legendPosition,
    legendOrient: parsed.legendOrient === "vertical" ? "vertical" : "horizontal",
    showFrame: bool(parsed.showFrame, DEFAULT_CHART_CONFIG.showFrame),
    // 旧フィールド showGrid（一括トグル）は X/Y 両方に引き継ぐ
    showGridX: bool(parsed.showGridX, bool(parsed.showGrid, DEFAULT_CHART_CONFIG.showGridX)),
    showGridY: bool(parsed.showGridY, bool(parsed.showGrid, DEFAULT_CHART_CONFIG.showGridY)),
  };
}

export function serializeChartBlockConfig(config: ChartBlockConfig): string {
  return JSON.stringify(config);
}

/** 系列の表示名（label 優先、無ければ列名） */
export function seriesDisplayName(config: ChartBlockConfig, column: string): string {
  return config.seriesOptions[column]?.label?.trim() || column;
}

/** right 軸に割り当てられた系列があるか */
export function usesRightAxis(config: ChartBlockConfig): boolean {
  return config.yColumns.some((c) => config.seriesOptions[c]?.axis === "right");
}
