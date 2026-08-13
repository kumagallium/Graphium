// チャートブロックの設定（props.config に JSON で保存する全体設定）
//
// eureco の設計に合わせ、系列（series）が第一級のデータモデル:
// 1 つの系列が「どのテーブルの・どの列を X/Y にするか」を自分で持つ。
// これにより複数のテーブルを 1 つのチャートに重ねられる。
// タブ構成は思考順序（何を見るか → スケール → 体裁）で、データの割り当ては
// 「何を見るか」= 種類・系列タブに属する。
//
// BlockNote の propSchema は primitive しか持てないため、設定一式を 1 つの
// JSON 文字列として保存する。ここで型とデフォルト・パースを一元管理し、
// 欠けたフィールドは常にデフォルトで埋める（後からフィールドを足しても
// 旧ノートが壊れない）。テーブルの参照は blockId — 表示名（表 1 等の自動名）は
// 毎回計算するだけなので、テーブルの並べ替えで参照は壊れない。

import { isNumericColumn, type ChartType, type TableData, type XAxisKind } from "./chart-data";
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

/** 系列ごとの種類（未指定はチャート全体の種類に従う）。histogram は全体専用 */
export type SeriesType = "line" | "bar" | "scatter";

/** 1 つの系列 = どのテーブルの・どの列を・どう描くか */
export type ChartSeriesConfig = {
  /** 参照先テーブルの blockId（表示名は毎回解決するので並べ替えに強い） */
  sourceBlockId: string;
  /** X に使う列名（histogram では未使用） */
  xColumn: string;
  /** Y（値）に使う列名 */
  yColumn: string;
  /** 凡例・ツールチップの表示名。空なら列名 */
  label?: string;
  /** 系列色。未指定はパレット順 */
  color?: string;
  /** 割り当てる Y 軸。既定は left。right を使うと第 2 軸が現れる */
  axis?: SeriesAxis;
  /** 系列ごとの種類（折れ線に棒を重ねる等）。未指定はチャートの種類に従う */
  type?: SeriesType;
};

export type ChartBlockConfig = {
  chartType: ChartType;
  /** 系列（順序 = 描画順・凡例順）。eureco 同様、データの割り当てはここが持つ */
  series: ChartSeriesConfig[];
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
  series: [],
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
const SERIES_TYPES: SeriesType[] = ["line", "bar", "scatter"];
const LEGEND_POSITIONS: LegendPosition[] = [
  "top-left",
  "top-right",
  "bottom",
  "inside-top-left",
  "inside-top-right",
  "inside-bottom-left",
  "inside-bottom-right",
];

function parseSeries(raw: unknown): ChartSeriesConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartSeriesConfig[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as any;
    if (typeof v.sourceBlockId !== "string" || typeof v.yColumn !== "string") continue;
    const entry: ChartSeriesConfig = {
      sourceBlockId: v.sourceBlockId,
      xColumn: typeof v.xColumn === "string" ? v.xColumn : "",
      yColumn: v.yColumn,
    };
    if (typeof v.label === "string" && v.label.trim() !== "") entry.label = v.label;
    if (typeof v.color === "string" && v.color.trim() !== "") entry.color = v.color;
    if (v.axis === "right") entry.axis = "right";
    if (SERIES_TYPES.includes(v.type)) entry.type = v.type;
    out.push(entry);
  }
  return out;
}

/**
 * 旧形式（チャート全体で 1 テーブル参照: sourceBlockId + xColumn + yColumns +
 * seriesOptions）を系列モデルに変換する。props.sourceBlockId は呼び出し側から
 * 渡してもらう（旧形式は config の外に持っていたため）。
 */
function migrateLegacyConfig(parsed: any, legacySourceBlockId: string): ChartSeriesConfig[] {
  const yColumns: string[] = Array.isArray(parsed.yColumns)
    ? parsed.yColumns.filter((v: unknown) => typeof v === "string")
    : [];
  const xColumn = typeof parsed.xColumn === "string" ? parsed.xColumn : "";
  if (!legacySourceBlockId) return [];
  // histogram は対象列を xColumn に持っていた → yColumn に移す
  if (parsed.chartType === "histogram" && xColumn) {
    return [{ sourceBlockId: legacySourceBlockId, xColumn: "", yColumn: xColumn }];
  }
  const options = typeof parsed.seriesOptions === "object" && parsed.seriesOptions !== null
    ? parsed.seriesOptions
    : {};
  return yColumns.map((yColumn) => {
    const o = (options as any)[yColumn] ?? {};
    const entry: ChartSeriesConfig = { sourceBlockId: legacySourceBlockId, xColumn, yColumn };
    if (typeof o.label === "string" && o.label.trim() !== "") entry.label = o.label;
    if (typeof o.color === "string" && o.color.trim() !== "") entry.color = o.color;
    if (o.axis === "right") entry.axis = "right";
    return entry;
  });
}

export function parseChartBlockConfig(raw: string, legacySourceBlockId = ""): ChartBlockConfig {
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
  const series = Array.isArray(parsed.series)
    ? parseSeries(parsed.series)
    : migrateLegacyConfig(parsed, legacySourceBlockId);
  return {
    chartType: CHART_TYPES.includes(parsed.chartType) ? parsed.chartType : DEFAULT_CHART_CONFIG.chartType,
    series,
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

/** 系列の表示名（label 優先、無ければ Y 列名） */
export function seriesConfigDisplayName(series: ChartSeriesConfig): string {
  return series.label?.trim() || series.yColumn;
}

/** right 軸に割り当てられた系列があるか */
export function usesRightAxis(config: ChartBlockConfig): boolean {
  return config.series.some((s) => s.axis === "right");
}

/** テーブル選択直後の初期系列: X = 最初の列、系列 = それ以外の数値列 */
export function suggestSeries(table: TableData, sourceBlockId: string): ChartSeriesConfig[] {
  const xColumn = table.headers[0] ?? "";
  return table.headers
    .slice(1)
    .filter((h) => h.trim() !== "" && isNumericColumn(table, h))
    .map((yColumn) => ({ sourceBlockId, xColumn, yColumn }));
}
