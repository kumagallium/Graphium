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
import type { DelimitedImportOptions } from "../../features/data-import/types";

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

/** 線の種類（折れ線） */
export type SeriesLineType = "solid" | "dashed" | "dotted";

/** 線の太さ（実寸は chart-theme.ts の CHART_LINE_WIDTHS） */
export type SeriesLineWidth = "thin" | "medium" | "thick";

/**
 * マーカーの形（ECharts の symbol 名をそのまま値にする）。
 * 白抜き（empty*）は点が重なっても下が見えるので、学術図では実用的。
 */
export type SeriesSymbolShape =
  | "circle"
  | "emptyCircle"
  | "rect"
  | "emptyRect"
  | "triangle"
  | "emptyTriangle"
  | "diamond"
  | "emptyDiamond";

/** マーカーの大きさ（実寸は chart-theme.ts の CHART_SYMBOL_SIZES） */
export type SeriesSymbolSize = "small" | "medium" | "large";

/** 棒の幅（実寸は chart-theme.ts の CHART_BAR_WIDTHS）。auto は ECharts 任せ */
export type SeriesBarWidth = "auto" | "narrow" | "medium" | "wide";

/**
 * 軸ごとの詳細設定（eureco の「詳細設定」に対応）。
 * 学術スタイルの既定（全表示・内向き目盛り・グリッドなし）から個別に外せる。
 */
export type AxisDetail = {
  /** 軸全体の表示（名前・線・目盛り・ラベルすべて） */
  show: boolean;
  /** 軸線の表示 */
  showLine: boolean;
  /** 目盛りの表示 */
  showTicks: boolean;
  /** 目盛りラベルの表示 */
  showLabels: boolean;
  /** 目盛りラベルの回転（null = 未設定） */
  labelRotate: number | null;
  /** 目盛りの向き（内向きが学術の既定） */
  tickInside: boolean;
  /** グリッド線の表示 */
  showGrid: boolean;
};

export const DEFAULT_AXIS_DETAIL: AxisDetail = {
  show: true,
  showLine: true,
  showTicks: true,
  showLabels: true,
  labelRotate: null,
  tickInside: true,
  showGrid: false,
};

/**
 * 系列の参照先になる素材（区切りテキストのデータ素材）。
 *
 * ノート内のテーブルは blockId で指すが、素材は媒体ライブラリ（media index）の
 * fileId で指す。系列側の sourceBlockId には `asset:<fileId>` を入れて、テーブル参照と
 * 同じ道（テーブルの解決・付け替え・段名の解決）に乗せる — 参照の種類が増えても
 * 系列の側は「ソースのキー + 列名」のままで済む。
 *
 * 読み方（options）は取り込みダイアログで決めた値をそのまま持つ。tableMeta.source と
 * 同じ考え方で、同じ設定で読み直せることが「この線はどの生データのどこか」の
 * 再現性になる。推定に任せると、推定ロジックの改良で既存の図の列が入れ替わりうる。
 */
export type ChartAssetSource = {
  /** 素材の fileId（media index のキー） */
  fileId: string;
  /** 素材名。表示名（段名の既定・凡例）と、参照切れ時の手掛かりに使う */
  fileName: string;
  /** 区切りテキストの読み方（見出し行・終了行・区切り文字） */
  options: DelimitedImportOptions;
};

/** 素材ソースのキーの接頭辞。fileId と blockId を同じ文字列空間で見分ける */
export const ASSET_SOURCE_PREFIX = "asset:";

/** 素材の fileId → 系列の sourceBlockId に入れるキー */
export function assetSourceKey(fileId: string): string {
  return `${ASSET_SOURCE_PREFIX}${fileId}`;
}

/** そのキーが素材ソースを指しているか */
export function isAssetSourceKey(key: string): boolean {
  return key.startsWith(ASSET_SOURCE_PREFIX) && key.length > ASSET_SOURCE_PREFIX.length;
}

/** キー → 素材の fileId。素材ソースでなければ null */
export function assetFileIdFromKey(key: string): string | null {
  return isAssetSourceKey(key) ? key.slice(ASSET_SOURCE_PREFIX.length) : null;
}

/** 素材ソースの表示名。取り込んだ表の既定キャプションと同じく拡張子を落とす */
export function assetSourceLabel(source: Pick<ChartAssetSource, "fileName">): string {
  return source.fileName.replace(/\.[^.]+$/, "").trim() || source.fileName;
}

/**
 * 系列が選べる参照先の 1 件（設定 UI・段名の解決に渡す表示用の一覧）。
 * ノート内テーブルは常に読めるが、素材は読み込み中・参照切れがある。
 */
export type ChartSourceOption = {
  /** 系列の sourceBlockId に入る値（blockId か `asset:<fileId>`） */
  id: string;
  label: string;
  kind: "table" | "asset";
  /** 素材のみ: 読み込み中 / 素材が見つからない（未指定は読めている） */
  status?: "pending" | "missing";
};

/** 1 つの系列 = どのテーブルの・どの列を・どう描くか */
export type ChartSeriesConfig = {
  /**
   * 参照先のキー。ノート内テーブルなら blockId（表示名は毎回解決するので
   * 並べ替えに強い）、データ素材なら `asset:<fileId>`（config.assetSources に読み方を持つ）
   */
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
  /**
   * スタック表示のときだけ効く倍率。弱いピークを拡大して見せる用
   *（論文図で "×5" と添えるやつ）。未指定は 1
   */
  scale?: number;
  /** スタック表示のときだけ効く段位置の微調整。段が重なるときに手で逃がす */
  offsetAdjust?: number;
  // ── 見た目（種類ごとに効くものが違う。未指定は種類なりの既定 = 従来の描画）──
  /** 線の種類（折れ線）。未指定は実線 */
  lineType?: SeriesLineType;
  /** 線の太さ（折れ線）。未指定は中 */
  lineWidth?: SeriesLineWidth;
  /** マーカーの表示（折れ線）。未指定は表示する */
  showSymbol?: boolean;
  /** マーカーの形（折れ線・散布図）。未指定は種類なりの既定（折れ線は白抜き円） */
  symbol?: SeriesSymbolShape;
  /** マーカーの大きさ（折れ線・散布図）。未指定は中 */
  symbolSize?: SeriesSymbolSize;
  /** 棒の幅（棒）。未指定は自動 */
  barWidth?: SeriesBarWidth;
  /**
   * 積み上げ（棒）。同じ Y 軸に割り当てた積み上げ系列同士が積み上がる。
   * スペクトル比較の StackConfig とは別物（あちらは折れ線を縦にずらす）
   */
  stacked?: boolean;
};

/** 段の名前をどこに出すか。inline = 各段の右端に直接（論文図の作法） */
export type StackLabelMode = "inline" | "legend";

/** 段を積む向き。first-bottom = 系列 1 が最下段（測定データを下に置く慣習） */
export type StackOrder = "first-bottom" | "first-top";

/**
 * 段名を段のどの隅に置くか。凡例の位置と同じ選び方で、段の中の四隅から選ぶ
 *（段名は凡例の代わりに図の中へ直接出るものなので、位置の決め方もそろえる）。
 * 既定が右上なのは、積み重ねスペクトルの段名を右肩に置く紙面の作法に合わせたもの。
 */
export type StackLabelPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/**
 * スタック表示（XRD などのスペクトル比較）。
 *
 * 系列を縦にずらして 1 つの枠に積む。図を複数並べる方式では、各図が自分の
 * 余白を持つうえに縦軸名・横軸目盛りが図の数だけ出てしまい、論文図の形にならない。
 * 1 枠に積めば縦軸名も横軸も 1 つになり、範囲指定も自動的に共通になる。
 *
 * 縦方向は「規格化してからずらす」のが前提。生値のままだと系列ごとに桁が違って
 * 段間隔を決められないため、既定で各段の最大値を 1 に揃える。
 */
export type StackConfig = {
  enabled: boolean;
  /** 段ごとの規格化。max = その段の最大値を 1 に。none は生値のまま積む */
  normalize: "max" | "none";
  /** 段間隔（規格化後の単位。1.0 で隣と接する、1.15 で少し空く） */
  gap: number;
  order: StackOrder;
  labels: StackLabelMode;
  /** 段名（labels = inline）を置く隅 */
  labelPosition: StackLabelPosition;
};

export const DEFAULT_STACK_CONFIG: StackConfig = {
  enabled: false,
  normalize: "max",
  gap: 1.15,
  order: "first-bottom",
  labels: "inline",
  labelPosition: "top-right",
};

/** 段間隔の許容範囲（0 = 完全に重ねる。上限は段が潰れない現実的な値） */
export const STACK_GAP_RANGE = { min: 0, max: 5 } as const;

/** 未指定を種類なりの既定で埋めた、描画・UI が使う実効スタイル */
export type ResolvedSeriesStyle = {
  lineType: SeriesLineType;
  lineWidth: SeriesLineWidth;
  showSymbol: boolean;
  symbol: SeriesSymbolShape;
  symbolSize: SeriesSymbolSize;
  barWidth: SeriesBarWidth;
  stacked: boolean;
};

/**
 * 系列の実効スタイル。既定値は「従来の描画」と一致させてあるので、
 * スタイルを一度も触っていない既存ノートは見た目が変わらない。
 * マーカーの形だけは種類で既定が違う（ECharts の既定: 折れ線は白抜き円、
 * 散布図は塗り円）ため、実効種類を受け取って解決する。
 */
export function resolveSeriesStyle(
  series: ChartSeriesConfig | undefined,
  effectiveType: SeriesType
): ResolvedSeriesStyle {
  return {
    lineType: series?.lineType ?? "solid",
    lineWidth: series?.lineWidth ?? "medium",
    showSymbol: series?.showSymbol ?? true,
    symbol: series?.symbol ?? (effectiveType === "line" ? "emptyCircle" : "circle"),
    symbolSize: series?.symbolSize ?? "medium",
    barWidth: series?.barWidth ?? "auto",
    stacked: series?.stacked ?? false,
  };
}

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
  /** 軸ごとの詳細設定 */
  xAxisDetail: AxisDetail;
  yAxisDetail: AxisDetail;
  yRightAxisDetail: AxisDetail;
  /** スタック表示（スペクトル比較） */
  stack: StackConfig;
  /**
   * 系列が参照するデータ素材（ノートの外にある生データ）。
   * 系列の sourceBlockId が `asset:<fileId>` のとき、ここから読み方を引く。
   * 旧ノートには無いので空配列で読まれる
   */
  assetSources: ChartAssetSource[];
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
  xAxisDetail: DEFAULT_AXIS_DETAIL,
  yAxisDetail: DEFAULT_AXIS_DETAIL,
  yRightAxisDetail: DEFAULT_AXIS_DETAIL,
  stack: DEFAULT_STACK_CONFIG,
  assetSources: [],
};

const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "histogram"];
const DELIMITERS: DelimitedImportOptions["delimiter"][] = ["comma", "tab", "space", "custom"];
const SERIES_TYPES: SeriesType[] = ["line", "bar", "scatter"];
const LINE_TYPES: SeriesLineType[] = ["solid", "dashed", "dotted"];
const LINE_WIDTHS: SeriesLineWidth[] = ["thin", "medium", "thick"];
export const SYMBOL_SHAPES: SeriesSymbolShape[] = [
  "circle",
  "emptyCircle",
  "rect",
  "emptyRect",
  "triangle",
  "emptyTriangle",
  "diamond",
  "emptyDiamond",
];
const SYMBOL_SIZES: SeriesSymbolSize[] = ["small", "medium", "large"];
const BAR_WIDTHS: SeriesBarWidth[] = ["auto", "narrow", "medium", "wide"];
export const STACK_LABEL_POSITIONS: StackLabelPosition[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
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
    // 倍率 0 以下は系列を消してしまうので読み捨てる（1 として扱う）
    if (typeof v.scale === "number" && Number.isFinite(v.scale) && v.scale > 0) {
      entry.scale = v.scale;
    }
    if (typeof v.offsetAdjust === "number" && Number.isFinite(v.offsetAdjust)) {
      entry.offsetAdjust = v.offsetAdjust;
    }
    // 見た目: 知らない値は落として既定に戻す（壊れた設定で描けなくなるより、
    // 既定の学術スタイルで描けるほうがよい）
    if (LINE_TYPES.includes(v.lineType)) entry.lineType = v.lineType;
    if (LINE_WIDTHS.includes(v.lineWidth)) entry.lineWidth = v.lineWidth;
    if (typeof v.showSymbol === "boolean") entry.showSymbol = v.showSymbol;
    if (SYMBOL_SHAPES.includes(v.symbol)) entry.symbol = v.symbol;
    if (SYMBOL_SIZES.includes(v.symbolSize)) entry.symbolSize = v.symbolSize;
    if (BAR_WIDTHS.includes(v.barWidth)) entry.barWidth = v.barWidth;
    if (typeof v.stacked === "boolean") entry.stacked = v.stacked;
    out.push(entry);
  }
  return out;
}

/**
 * 素材ソースを読む。読み方（options）が欠けた・壊れたエントリは落とす — 推定で
 * 補うと、系列が指していた列と別の列を描きかねない。同じ fileId は先勝ち。
 */
function parseAssetSources(raw: unknown): ChartAssetSource[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartAssetSource[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "object" || value === null) continue;
    const v = value as any;
    if (typeof v.fileId !== "string" || v.fileId === "" || seen.has(v.fileId)) continue;
    const o = typeof v.options === "object" && v.options !== null ? v.options : null;
    if (!o) continue;
    const headerRow = Number(o.headerRow);
    const endRow = Number(o.endRow);
    if (!Number.isInteger(headerRow) || headerRow < 1) continue;
    if (!Number.isInteger(endRow) || endRow < headerRow) continue;
    if (!DELIMITERS.includes(o.delimiter)) continue;
    const options: DelimitedImportOptions = {
      headerRow,
      endRow,
      delimiter: o.delimiter,
      collapseConsecutive: o.collapseConsecutive === true,
    };
    if (typeof o.customDelimiter === "string" && o.customDelimiter !== "") {
      options.customDelimiter = o.customDelimiter;
    }
    seen.add(v.fileId);
    out.push({
      fileId: v.fileId,
      fileName: typeof v.fileName === "string" ? v.fileName : "",
      options,
    });
  }
  return out;
}

/**
 * どの系列からも参照されなくなった素材ソースを落とす。
 * 素材ソースは「いま描いている生データ」の一覧であって、候補の棚ではない。
 * 残すと、描いていない素材が「このノートで使われている」として来歴に載り続ける。
 */
export function pruneAssetSources(config: ChartBlockConfig): ChartBlockConfig {
  if (config.assetSources.length === 0) return config;
  const referenced = new Set(
    config.series.map((s) => assetFileIdFromKey(s.sourceBlockId)).filter((id): id is string => !!id)
  );
  const kept = config.assetSources.filter((a) => referenced.has(a.fileId));
  return kept.length === config.assetSources.length ? config : { ...config, assetSources: kept };
}

/** このチャートが参照している素材の fileId（来歴・利用ノートの集計用） */
export function collectChartAssetFileIds(config: ChartBlockConfig): string[] {
  return config.assetSources.map((a) => a.fileId);
}

/** スタック設定を部分マージで読む（旧ノートには存在しないので全欠けが常態） */
function parseStack(raw: unknown): StackConfig {
  const v = (typeof raw === "object" && raw !== null ? raw : {}) as any;
  const gap =
    typeof v.gap === "number" && Number.isFinite(v.gap)
      ? Math.min(STACK_GAP_RANGE.max, Math.max(STACK_GAP_RANGE.min, v.gap))
      : DEFAULT_STACK_CONFIG.gap;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_STACK_CONFIG.enabled,
    normalize: v.normalize === "none" ? "none" : DEFAULT_STACK_CONFIG.normalize,
    gap,
    order: v.order === "first-top" ? "first-top" : DEFAULT_STACK_CONFIG.order,
    labels: v.labels === "legend" ? "legend" : DEFAULT_STACK_CONFIG.labels,
    labelPosition: STACK_LABEL_POSITIONS.includes(v.labelPosition)
      ? v.labelPosition
      : DEFAULT_STACK_CONFIG.labelPosition,
  };
}

/** 軸の詳細設定を部分マージで読む（欠けはデフォルト、旧グリッドフラグを引き継げる） */
function parseAxisDetail(raw: unknown, gridFallback: boolean): AxisDetail {
  const v = (typeof raw === "object" && raw !== null ? raw : {}) as any;
  const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
  return {
    show: bool(v.show, DEFAULT_AXIS_DETAIL.show),
    showLine: bool(v.showLine, DEFAULT_AXIS_DETAIL.showLine),
    showTicks: bool(v.showTicks, DEFAULT_AXIS_DETAIL.showTicks),
    showLabels: bool(v.showLabels, DEFAULT_AXIS_DETAIL.showLabels),
    labelRotate: typeof v.labelRotate === "number" ? v.labelRotate : null,
    tickInside: bool(v.tickInside, DEFAULT_AXIS_DETAIL.tickInside),
    showGrid: bool(v.showGrid, gridFallback),
  };
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
    // 旧フィールド showGrid（一括）/ showGridX / showGridY は軸詳細のグリッドに引き継ぐ
    xAxisDetail: parseAxisDetail(
      parsed.xAxisDetail,
      bool(parsed.showGridX, bool(parsed.showGrid, false))
    ),
    yAxisDetail: parseAxisDetail(
      parsed.yAxisDetail,
      bool(parsed.showGridY, bool(parsed.showGrid, false))
    ),
    yRightAxisDetail: parseAxisDetail(parsed.yRightAxisDetail, false),
    stack: parseStack(parsed.stack),
    assetSources: parseAssetSources(parsed.assetSources),
  };
}

export function serializeChartBlockConfig(config: ChartBlockConfig): string {
  return JSON.stringify(config);
}

/** 系列の表示名（label 優先、無ければ Y 列名） */
export function seriesConfigDisplayName(series: ChartSeriesConfig): string {
  return series.label?.trim() || series.yColumn;
}

/**
 * スタック時の段名。label > テーブル名 > Y 列名 の順で解決する。
 *
 * 通常の凡例と違って既定値がテーブル名なのは、スペクトル比較では各段が
 * 「別の試料・別の文献」であって「別の列」ではないため。XRD なら全段の Y 列が
 * Intensity なので、列名を出すと段の区別がつかない。
 */
export function stackSeriesDisplayName(
  series: ChartSeriesConfig,
  tableLabel: string | undefined
): string {
  return series.label?.trim() || tableLabel?.trim() || series.yColumn;
}

/**
 * スタック表示が実際に効くか。
 *
 * ヒストグラムは縦軸が度数そのもので、段をずらすと数え上げの意味が壊れる。
 * カテゴリ軸も段のオフセットが目盛りとかみ合わないため外す（軸種は
 * データを読んで初めて決まるので、呼び出し側から渡してもらう）。
 */
export function isStackActive(config: ChartBlockConfig, xAxisKind?: XAxisKind): boolean {
  if (!config.stack.enabled) return false;
  if (config.chartType === "histogram") return false;
  if (xAxisKind === "category") return false;
  return config.series.length > 0;
}

/** right 軸に割り当てられた系列があるか */
export function usesRightAxis(config: ChartBlockConfig): boolean {
  return config.series.some((s) => s.axis === "right");
}

/**
 * 参照先を替えたとき、同名列が無ければ新しい表の妥当な列に付け替える。
 * 参照先はノート内テーブルでも素材でも同じ扱い（表として読めた後は区別しない）。
 */
export function retargetSeries(
  series: ChartSeriesConfig,
  newSourceKey: string,
  table: TableData | null
): ChartSeriesConfig {
  if (!table) return { ...series, sourceBlockId: newSourceKey };
  const headers = table.headers.filter((h) => h.trim() !== "");
  const numeric = headers.filter((h) => isNumericColumn(table, h));
  const xColumn = headers.includes(series.xColumn) ? series.xColumn : (table.headers[0] ?? "");
  const yColumn = numeric.includes(series.yColumn)
    ? series.yColumn
    : (numeric.find((h) => h !== xColumn) ?? numeric[0] ?? "");
  return { ...series, sourceBlockId: newSourceKey, xColumn, yColumn };
}

/** テーブル選択直後の初期系列: X = 最初の列、系列 = それ以外の数値列 */
export function suggestSeries(table: TableData, sourceBlockId: string): ChartSeriesConfig[] {
  const xColumn = table.headers[0] ?? "";
  return table.headers
    .slice(1)
    .filter((h) => h.trim() !== "" && isNumericColumn(table, h))
    .map((yColumn) => ({ sourceBlockId, xColumn, yColumn }));
}
