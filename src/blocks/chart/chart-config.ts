// チャートブロックの設定（props.config に JSON で保存する全体設定）
//
// BlockNote の propSchema は primitive しか持てないため、設定一式を 1 つの
// JSON 文字列として保存する。ここで型とデフォルト・パースを一元管理し、
// 欠けたフィールドは常にデフォルトで埋める（後からフィールドを足しても
// 旧ノートが壊れない）。

import type { ChartType } from "./chart-data";
import { CHART_ASPECT_RATIOS, type ChartAspect } from "./chart-theme";

export type LegendPosition = "top-left" | "top-right" | "bottom";

export type ChartBlockConfig = {
  chartType: ChartType;
  /** X 軸に使う列名（histogram では対象の数値列） */
  xColumn: string;
  /** 系列にする列名（順序 = 描画順・凡例順） */
  yColumns: string[];
  /** 図の下に表示するキャプション（論文の Figure caption 相当） */
  caption: string;
  /** 軸名。空なら列名から自動 */
  xAxisName: string;
  yAxisName: string;
  /** Y 軸の最小/最大。空文字 = 自動 */
  yMin: string;
  yMax: string;
  aspect: ChartAspect;
  showLegend: boolean;
  legendPosition: LegendPosition;
  /** プロット領域の全周枠（黒 box） */
  showFrame: boolean;
  /** グリッド線（splitLine, 破線） */
  showGrid: boolean;
};

export const DEFAULT_CHART_CONFIG: ChartBlockConfig = {
  chartType: "line",
  xColumn: "",
  yColumns: [],
  caption: "",
  xAxisName: "",
  yAxisName: "",
  yMin: "",
  yMax: "",
  aspect: "standard",
  showLegend: true,
  legendPosition: "top-left",
  showFrame: true,
  showGrid: false,
};

const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "histogram"];
const LEGEND_POSITIONS: LegendPosition[] = ["top-left", "top-right", "bottom"];

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
    caption: str(parsed.caption, ""),
    xAxisName: str(parsed.xAxisName, ""),
    yAxisName: str(parsed.yAxisName, ""),
    yMin: str(parsed.yMin, ""),
    yMax: str(parsed.yMax, ""),
    aspect: parsed.aspect in CHART_ASPECT_RATIOS ? parsed.aspect : DEFAULT_CHART_CONFIG.aspect,
    showLegend: bool(parsed.showLegend, DEFAULT_CHART_CONFIG.showLegend),
    legendPosition: LEGEND_POSITIONS.includes(parsed.legendPosition)
      ? parsed.legendPosition
      : DEFAULT_CHART_CONFIG.legendPosition,
    showFrame: bool(parsed.showFrame, DEFAULT_CHART_CONFIG.showFrame),
    showGrid: bool(parsed.showGrid, DEFAULT_CHART_CONFIG.showGrid),
  };
}

export function serializeChartBlockConfig(config: ChartBlockConfig): string {
  return JSON.stringify(config);
}
