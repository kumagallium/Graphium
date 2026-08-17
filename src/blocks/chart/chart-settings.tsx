// チャート設定パネル
//
// eureco の「チャートの設定」ポップオーバーに合わせたタブ式パネル。
// タブは思考順序（何を見るか → スケール → 体裁）で、データの割り当て
//（どのテーブルの・どの列か）は「何を見るか」なので種類・系列タブが持つ。
// 系列は行を開くと個別設定（名前・データの割り当て・種類・色・軸）になる。
// UI ニュートラル色は design.md のトークン、寸法は 8pt 格子から。

import { useMemo, useState } from "react";
import { X, ChevronUp, ChevronDown, ChevronRight, Database, Palette, Plus } from "lucide-react";
import { t } from "../../i18n";
import { detectXAxisKind, isNumericColumn, type TableData } from "./chart-data";
import type { ChartType } from "./chart-data";
import { CHART_SERIES_COLORS } from "./chart-theme";
import {
  isAssetSourceKey,
  isStackActive,
  resolveSeriesStyle,
  retargetSeries,
  seriesConfigDisplayName,
  usesRightAxis,
  STACK_GAP_RANGE,
  type AxisDetail,
  type ChartBlockConfig,
  type ChartSeriesConfig,
  type ChartSourceOption,
  type LegendPosition,
  type SeriesBarWidth,
  type SeriesLineType,
  type SeriesLineWidth,
  type SeriesSymbolShape,
  type SeriesSymbolSize,
  type SeriesType,
  type StackConfig,
  type StackLabelMode,
  type StackLabelPosition,
  type StackOrder,
  type XAxisKindSetting,
} from "./chart-config";
import type { ChartAspect } from "./chart-theme";

/** 設定パネル内のトグルスイッチ（settings/modal.tsx の switch と同じ見た目） */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  /** 他の設定に上書きされて効かない状態（積み重ね中の目盛り表示など） */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        width: 32,
        height: 18,
        borderRadius: 999,
        border: "1px solid var(--color-border)",
        background: checked ? "var(--color-primary)" : "var(--color-input)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        transition: "background 0.15s",
        padding: 0,
      }}
    >
      <span
        style={{
          display: "block",
          width: 14,
          height: 14,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
          transition: "transform 0.2s",
          transform: checked ? "translateX(15px)" : "translateX(1px)",
        }}
      />
    </button>
  );
}

const ROTATE_CHOICES = [0, 30, 45, 90];

/**
 * 任意入力の数値を読む。空欄・読めない値は未設定（undefined = 既定値に戻す）。
 * positiveOnly は倍率用（0 以下だと系列が消えるため受け付けない）。
 */
function parseOptionalNumber(raw: string, positiveOnly: boolean): number | undefined {
  const s = raw.trim();
  if (s === "") return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  if (positiveOnly && n <= 0) return undefined;
  return n;
}

/**
 * 軸ごとの「詳細設定」（eureco 準拠の折りたたみ）:
 * 軸・軸線・目盛り・目盛りラベルの表示、ラベルの回転、目盛りの向き、グリッド。
 *
 * 縦軸に限り、末尾に積み重ね（スペクトル比較）の設定を持つ。使う場面が
 * 限られる特殊な描き方なので、常時見えるところには置かない。
 */
function AxisDetailEditor({
  detail,
  onChange,
  stack,
  onStackChange,
}: {
  detail: AxisDetail;
  onChange: (patch: Partial<AxisDetail>) => void;
  /** 縦軸のときだけ渡す。積み重ねの設定をこの折りたたみに同居させる */
  stack?: StackConfig;
  onStackChange?: (patch: Partial<StackConfig>) => void;
}) {
  const [open, setOpen] = useState(false);
  // 積み重ね中は縦軸の目盛りを描画側で強制的に消すため、ここの指定は効かない
  const ticksLocked = stack?.enabled ?? false;
  return (
    <div style={detailStyles.shell}>
      <button type="button" onClick={() => setOpen(!open)} style={detailStyles.header}>
        <span>{t("chart.advanced")}</span>
        {open ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}
      </button>
      {open && (
        <div style={detailStyles.body}>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.axisShow")}</span>
            <Toggle checked={detail.show} onChange={(v) => onChange({ show: v })} />
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.axisLineShow")}</span>
            <Toggle checked={detail.showLine} onChange={(v) => onChange({ showLine: v })} />
          </div>
          <div style={detailStyles.row}>
            <span style={{ ...detailStyles.label, opacity: ticksLocked ? 0.4 : 1 }}>
              {t("chart.ticksShow")}
            </span>
            <Toggle
              checked={detail.showTicks && !ticksLocked}
              disabled={ticksLocked}
              onChange={(v) => onChange({ showTicks: v })}
            />
          </div>
          <div style={detailStyles.row}>
            <span style={{ ...detailStyles.label, opacity: ticksLocked ? 0.4 : 1 }}>
              {t("chart.tickLabelsShow")}
            </span>
            <Toggle
              checked={detail.showLabels && !ticksLocked}
              disabled={ticksLocked}
              onChange={(v) => onChange({ showLabels: v })}
            />
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.tickLabelRotate")}</span>
            <select
              value={detail.labelRotate === null ? "" : String(detail.labelRotate)}
              onChange={(e) =>
                onChange({ labelRotate: e.target.value === "" ? null : Number(e.target.value) })
              }
              style={detailStyles.smallSelect}
            >
              <option value="">{t("chart.rotateNone")}</option>
              {ROTATE_CHOICES.map((deg) => (
                <option key={deg} value={deg}>
                  {deg}°
                </option>
              ))}
            </select>
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.tickKind")}</span>
            <select
              value={detail.tickInside ? "inside" : "outside"}
              onChange={(e) => onChange({ tickInside: e.target.value === "inside" })}
              style={detailStyles.smallSelect}
            >
              <option value="inside">{t("chart.tickInside")}</option>
              <option value="outside">{t("chart.tickOutside")}</option>
            </select>
          </div>
          <div style={detailStyles.row}>
            <span style={{ ...detailStyles.label, opacity: ticksLocked ? 0.4 : 1 }}>
              {t("chart.gridShow")}
            </span>
            <Toggle
              checked={detail.showGrid && !ticksLocked}
              disabled={ticksLocked}
              onChange={(v) => onChange({ showGrid: v })}
            />
          </div>
          {stack && onStackChange && <StackFields stack={stack} onChange={onStackChange} />}
        </div>
      )}
    </div>
  );
}

/**
 * 積み重ね（スペクトル比較）の設定。縦軸の「詳細設定」の末尾に置く。
 *
 * 縦軸の目盛りを消して系列を段に分ける描き方なので、目盛りの表示設定と同じ
 * 場所にある方がどちらが効いているのか分かる。使う場面は限られるため、
 * 折りたたみの外には出さない。
 */
function StackFields({
  stack,
  onChange,
}: {
  stack: StackConfig;
  onChange: (patch: Partial<StackConfig>) => void;
}) {
  const [open, setOpen] = useState(stack.enabled);
  return (
    <div style={detailStyles.subGroup}>
      <div style={detailStyles.subHeader}>
        <button type="button" onClick={() => setOpen(!open)} style={detailStyles.subHeaderButton}>
          <span>{t("chart.sectionStack")}</span>
          {open ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
        </button>
        {/* 入り切りは畳んだままでも触れる。入れたら中身を出す（設定せずに閉じない） */}
        <Toggle
          checked={stack.enabled}
          onChange={(v) => {
            onChange({ enabled: v });
            if (v) setOpen(true);
          }}
        />
      </div>
      {open && !stack.enabled && <div style={detailStyles.hint}>{t("chart.stackHint")}</div>}
      {open && stack.enabled && (
        <>
          <div style={detailStyles.hint}>{t("chart.stackHint")}</div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.stackNormalize")}</span>
            <select
              value={stack.normalize}
              onChange={(e) => onChange({ normalize: e.target.value as StackConfig["normalize"] })}
              style={detailStyles.smallSelect}
            >
              <option value="max">{t("chart.stackNormalizeMax")}</option>
              <option value="none">{t("chart.stackNormalizeNone")}</option>
            </select>
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.stackGap")}</span>
            <span style={detailStyles.rangeGroup}>
              <input
                type="range"
                min={STACK_GAP_RANGE.min}
                max={STACK_GAP_RANGE.max}
                step={0.05}
                value={stack.gap}
                onChange={(e) => onChange({ gap: Number(e.target.value) })}
                style={{ width: 64 }}
              />
              <span style={detailStyles.rangeValue}>{stack.gap.toFixed(2)}</span>
            </span>
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.stackOrder")}</span>
            <span style={styles.segment}>
              {(["first-bottom", "first-top"] as const).map((order: StackOrder) => (
                <button
                  key={order}
                  type="button"
                  onClick={() => onChange({ order })}
                  style={{
                    ...styles.segmentButton,
                    ...(stack.order === order ? styles.segmentButtonActive : {}),
                  }}
                >
                  {order === "first-bottom"
                    ? t("chart.stackOrderFirstBottom")
                    : t("chart.stackOrderFirstTop")}
                </button>
              ))}
            </span>
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.stackLabels")}</span>
            <span style={styles.segment}>
              {(["inline", "legend"] as const).map((mode: StackLabelMode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onChange({ labels: mode })}
                  style={{
                    ...styles.segmentButton,
                    ...(stack.labels === mode ? styles.segmentButtonActive : {}),
                  }}
                >
                  {mode === "inline"
                    ? t("chart.stackLabelsInline")
                    : t("chart.stackLabelsLegend")}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

const detailStyles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    borderRadius: 6,
    background: "var(--color-muted)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "5px 8px",
    fontSize: 12,
    border: "none",
    background: "transparent",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    padding: "2px 8px 8px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  label: {
    fontSize: 12,
    color: "var(--color-foreground)",
    // 「マーカーの大きさ」のような長いラベルが 2 行に折れないようにする
    whiteSpace: "nowrap",
  },
  smallSelect: {
    width: 96,
    padding: "2px 6px",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
  },
  // 詳細設定の中の入れ子グループ。折りたたみのヘッダ（chevron 付き）で
  // 他の行と区別が付くので、区切り線などは足さない
  subGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  subHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  subHeaderButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 0,
    fontSize: 12,
    border: "none",
    background: "transparent",
    color: "var(--color-foreground)",
    cursor: "pointer",
  },
  hint: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "var(--color-text-tertiary)",
  },
  rangeGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  rangeValue: {
    width: 28,
    textAlign: "right",
    fontSize: 11,
    color: "var(--color-text-tertiary)",
  },
};

/** マーカーの形（塗り → 白抜きを形ごとに並べる。値は ECharts の symbol 名） */
const SYMBOL_SHAPE_KEYS: Array<[SeriesSymbolShape, string]> = [
  ["circle", "chart.symbolCircle"],
  ["emptyCircle", "chart.symbolEmptyCircle"],
  ["rect", "chart.symbolRect"],
  ["emptyRect", "chart.symbolEmptyRect"],
  ["triangle", "chart.symbolTriangle"],
  ["emptyTriangle", "chart.symbolEmptyTriangle"],
  ["diamond", "chart.symbolDiamond"],
  ["emptyDiamond", "chart.symbolEmptyDiamond"],
];

/**
 * 系列の見た目（eureco の「オプション > スタイル」）。
 * 効く項目は系列の実効種類で変わる: 折れ線は線とマーカー、散布図はマーカー、
 * 棒は幅と積み上げ。色だけは全種類に共通。分布（ヒストグラム）は図全体が
 * 1 つの分布なので色だけ持つ。
 */
function SeriesStyleEditor({
  series,
  effectiveType,
  fallbackColor,
  onChange,
}: {
  series: ChartSeriesConfig;
  effectiveType: SeriesType | "histogram";
  fallbackColor: string;
  onChange: (patch: Partial<ChartSeriesConfig>) => void;
}) {
  const [open, setOpen] = useState(false);
  const style = resolveSeriesStyle(series, effectiveType === "histogram" ? "bar" : effectiveType);
  const color = series.color || fallbackColor;
  const isLine = effectiveType === "line";
  const isScatter = effectiveType === "scatter";
  const isBar = effectiveType === "bar";
  // 折れ線でマーカーを消しているときは、形・大きさを薄く出して効かないことを示す
  const markerActive = isScatter || style.showSymbol;
  const markerRow = markerActive ? {} : { opacity: 0.5 };
  return (
    <div style={styleStyles.shell}>
      <button type="button" onClick={() => setOpen(!open)} style={detailStyles.header}>
        <span style={styleStyles.headerLabel}>
          <Palette size={13} strokeWidth={2} />
          {t("chart.seriesStyle")}
        </span>
        {open ? <ChevronUp size={13} strokeWidth={2} /> : <ChevronDown size={13} strokeWidth={2} />}
      </button>
      {open && (
        <div style={detailStyles.body}>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.seriesColor")}</span>
            <span style={styleStyles.colorRow}>
              {CHART_SERIES_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ color: c })}
                  style={{
                    ...styles.colorSwatchButton,
                    background: c,
                    outline: color === c ? `2px solid ${c}` : "none",
                    outlineOffset: 1,
                  }}
                  title={c}
                />
              ))}
            </span>
          </div>

          {isLine && (
            <>
              <div style={detailStyles.row}>
                <span style={detailStyles.label}>{t("chart.lineType")}</span>
                <select
                  value={style.lineType}
                  onChange={(e) => onChange({ lineType: e.target.value as SeriesLineType })}
                  style={styleStyles.select}
                >
                  <option value="solid">{t("chart.lineSolid")}</option>
                  <option value="dashed">{t("chart.lineDashed")}</option>
                  <option value="dotted">{t("chart.lineDotted")}</option>
                </select>
              </div>
              <div style={detailStyles.row}>
                <span style={detailStyles.label}>{t("chart.lineWidth")}</span>
                <select
                  value={style.lineWidth}
                  onChange={(e) => onChange({ lineWidth: e.target.value as SeriesLineWidth })}
                  style={styleStyles.select}
                >
                  <option value="thin">{t("chart.widthThin")}</option>
                  <option value="medium">{t("chart.sizeMedium")}</option>
                  <option value="thick">{t("chart.widthThick")}</option>
                </select>
              </div>
              <div style={detailStyles.row}>
                <span style={detailStyles.label}>{t("chart.showSymbol")}</span>
                <Toggle
                  checked={style.showSymbol}
                  onChange={(v) => onChange({ showSymbol: v })}
                />
              </div>
            </>
          )}

          {(isLine || isScatter) && (
            <>
              <div style={{ ...detailStyles.row, ...markerRow }}>
                <span style={detailStyles.label}>{t("chart.symbolShape")}</span>
                <select
                  value={style.symbol}
                  disabled={!markerActive}
                  onChange={(e) => onChange({ symbol: e.target.value as SeriesSymbolShape })}
                  style={styleStyles.select}
                >
                  {SYMBOL_SHAPE_KEYS.map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key as any)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ ...detailStyles.row, ...markerRow }}>
                <span style={detailStyles.label}>{t("chart.symbolSize")}</span>
                <select
                  value={style.symbolSize}
                  disabled={!markerActive}
                  onChange={(e) => onChange({ symbolSize: e.target.value as SeriesSymbolSize })}
                  style={styleStyles.select}
                >
                  <option value="small">{t("chart.sizeSmall")}</option>
                  <option value="medium">{t("chart.sizeMedium")}</option>
                  <option value="large">{t("chart.sizeLarge")}</option>
                </select>
              </div>
            </>
          )}

          {isBar && (
            <>
              <div style={detailStyles.row}>
                <span style={detailStyles.label}>{t("chart.barWidth")}</span>
                <select
                  value={style.barWidth}
                  onChange={(e) => onChange({ barWidth: e.target.value as SeriesBarWidth })}
                  style={styleStyles.select}
                >
                  <option value="auto">{t("chart.barWidthAuto")}</option>
                  <option value="narrow">{t("chart.barNarrow")}</option>
                  <option value="medium">{t("chart.sizeMedium")}</option>
                  <option value="wide">{t("chart.barWide")}</option>
                </select>
              </div>
              <div style={detailStyles.row}>
                <span style={detailStyles.label}>{t("chart.stacked")}</span>
                <Toggle checked={style.stacked} onChange={(v) => onChange({ stacked: v })} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const styleStyles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    borderRadius: 6,
    // 系列詳細（muted）の中に入るので、1 段明るくして沈ませない
    background: "var(--color-card)",
  },
  headerLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  },
  select: {
    width: 104,
    padding: "2px 6px",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
  },
  colorRow: {
    display: "inline-flex",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
    // 8 色が 1 行に収まる幅（16px × 8 + gap 4px × 7）
    maxWidth: 164,
  },
};

type Tab = "typeSeries" | "axes" | "appearance";

const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "histogram"];

export function chartTypeLabel(type: ChartType): string {
  switch (type) {
    case "line":
      return t("chart.typeLine");
    case "bar":
      return t("chart.typeBar");
    case "scatter":
      return t("chart.typeScatter");
    case "histogram":
      return t("chart.typeHistogram");
  }
}

const LEGEND_POSITION_KEYS: Array<[LegendPosition, string]> = [
  ["top-left", "chart.posTopLeft"],
  ["top-right", "chart.posTopRight"],
  ["inside-top-left", "chart.posInsideTopLeft"],
  ["inside-top-right", "chart.posInsideTopRight"],
  ["inside-bottom-left", "chart.posInsideBottomLeft"],
  ["inside-bottom-right", "chart.posInsideBottomRight"],
  ["bottom", "chart.posBottom"],
];

/** 段名の位置。凡例と同じ並び（左上→右上→左下→右下）で、置き場所は段の中 */
const STACK_LABEL_POSITION_KEYS: Array<[StackLabelPosition, string]> = [
  ["top-left", "chart.stackPosTopLeft"],
  ["top-right", "chart.stackPosTopRight"],
  ["bottom-left", "chart.stackPosBottomLeft"],
  ["bottom-right", "chart.stackPosBottomRight"],
];

/** 参照先 select の「素材のデータから選ぶ…」に使う擬似値（実在のキーと衝突しない） */
const PICK_ASSET_OPTION = "__pick-asset__";

export function ChartSettingsPanel({
  config,
  onChange,
  tables,
  resolveTable,
  onPickAsset,
  placement = "overlay",
  onClose,
}: {
  config: ChartBlockConfig;
  onChange: (patch: Partial<ChartBlockConfig>) => void;
  /** 系列が選べる参照先（ノート内テーブル + このチャートが参照している素材） */
  tables: ChartSourceOption[];
  resolveTable: (blockId: string) => TableData | null;
  /**
   * 素材のデータを参照先にする（ピッカー → 取り込みダイアログをホストが開く）。
   * null = 新しい系列を足す、番号 = その系列の参照先を付け替える。
   * 未指定ならこのエディタでは素材を選べない（入口を出さない）
   */
  onPickAsset?: (target: number | null) => void;
  /** outside = ボタンの右（チャートの外）に出す。overlay = 右上に重ねる */
  placement?: "outside" | "overlay";
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("typeSeries");
  const [expandedSeries, setExpandedSeries] = useState<number | null>(null);
  const isHistogram = config.chartType === "histogram";
  const rightAxisInUse = usesRightAxis(config) && !isHistogram;

  // X 軸の実効的な目盛り種類（min/max 入力の有効・無効の判定に使う）
  const effectiveXKind = useMemo(() => {
    if (config.chartType === "histogram") return "category";
    if (config.xAxisKind !== "auto") return config.xAxisKind;
    if (config.chartType === "bar") return "category";
    const xValues = config.series.flatMap((s) => {
      const table = resolveTable(s.sourceBlockId);
      if (!table) return [];
      const idx = table.headers.findIndex((h) => h.trim() === s.xColumn.trim());
      if (idx < 0) return [];
      return table.rows.map((r) => r[idx] ?? "");
    });
    return detectXAxisKind(xValues);
  }, [config.chartType, config.xAxisKind, config.series, resolveTable]);

  // 段名が図の中に直接出ている状態（このとき通常の凡例は描かれない）
  const inlineStackLabels =
    config.stack.labels === "inline" && isStackActive(config, effectiveXKind);

  const updateSeries = (index: number, patch: Partial<ChartSeriesConfig>) => {
    const next = config.series.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange({ series: next });
  };

  const updateStack = (patch: Partial<StackConfig>) => {
    onChange({ stack: { ...config.stack, ...patch } });
  };

  const moveSeries = (index: number, delta: number) => {
    const next = [...config.series];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ series: next });
  };

  const addSeries = () => {
    // 直前の系列のテーブル・X 列を引き継ぎ、Y は未使用の数値列から選ぶ
    const last = config.series[config.series.length - 1];
    const sourceBlockId = last?.sourceBlockId ?? tables[0]?.id ?? "";
    if (!sourceBlockId) return;
    const table = resolveTable(sourceBlockId);
    const numeric = table
      ? table.headers.filter((h) => h.trim() !== "" && isNumericColumn(table, h))
      : [];
    const used = new Set(
      config.series.filter((s) => s.sourceBlockId === sourceBlockId).map((s) => s.yColumn)
    );
    const yColumn = numeric.find((h) => !used.has(h)) ?? numeric[0] ?? last?.yColumn ?? "";
    const xColumn = last?.xColumn ?? table?.headers[0] ?? "";
    onChange({ series: [...config.series, { sourceBlockId, xColumn, yColumn }] });
    setExpandedSeries(config.series.length);
  };

  return (
    <div
      style={{
        ...styles.panel,
        ...(placement === "outside"
          ? // ボタンの右、チャートの外側。図を隠さないのでガラス処理も不要
            { top: 0, left: "calc(100% + 8px)", right: "auto", background: "var(--color-surface)" }
          : {}),
      }}
      data-test="chart-settings"
    >
      <div style={styles.header}>
        <span style={styles.title}>{t("chart.settingsTitle")}</span>
        <button type="button" onClick={onClose} style={styles.closeButton} title={t("chart.close")}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div style={styles.tabBar} role="tablist">
        {(
          [
            ["typeSeries", t("chart.tabTypeSeries")],
            ["axes", t("chart.tabAxes")],
            ["appearance", t("chart.tabAppearance")],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "typeSeries" && (
        <div style={styles.body}>
          <div style={styles.sectionLabel}>{t("chart.sectionType")}</div>
          <select
            value={config.chartType}
            onChange={(e) => onChange({ chartType: e.target.value as ChartType })}
            style={styles.select}
          >
            {CHART_TYPES.map((type) => (
              <option key={type} value={type}>
                {chartTypeLabel(type)}
              </option>
            ))}
          </select>
          {/* 複合図（棒＋折れ線）は系列の「種類」で作る。系列を開かないと出会えない
              設定なので、複数系列があるときだけここで存在を知らせる */}
          {!isHistogram && config.series.length >= 2 && (
            <div style={styles.fieldHint}>{t("chart.comboHint")}</div>
          )}

          <div style={styles.sectionLabel}>{t("chart.sectionSeries")}</div>
          <div style={styles.seriesList}>
            {config.series.map((series, i) => {
              const color = series.color || CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
              const expanded = expandedSeries === i;
              const table = resolveTable(series.sourceBlockId);
              const headers = (table?.headers ?? []).filter((h) => h.trim() !== "");
              const numericHeaders = table ? headers.filter((h) => isNumericColumn(table, h)) : [];
              // 参照先の状態。テーブルは一覧に無ければ消えている。素材は一覧に残るが
              // 読み込み中・見つからない、がある
              const source = tables.find(({ id }) => id === series.sourceBlockId);
              const sourceNote = !table
                ? source?.status === "pending"
                  ? t("chart.seriesLoading")
                  : isAssetSourceKey(series.sourceBlockId)
                    ? t("chart.seriesAssetGone")
                    : t("chart.seriesTableGone")
                : null;
              return (
                <div key={`${series.sourceBlockId}:${series.yColumn}:${i}`} style={styles.seriesItem}>
                  <div style={styles.seriesRow}>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => setExpandedSeries(expanded ? null : i)}
                      title={t("chart.seriesSettings")}
                    >
                      {expanded ? (
                        <ChevronDown size={13} strokeWidth={2} />
                      ) : (
                        <ChevronRight size={13} strokeWidth={2} />
                      )}
                    </button>
                    <span style={{ ...styles.swatch, background: color }} />
                    <span style={styles.seriesName}>
                      {seriesConfigDisplayName(series)}
                      {/* チャート全体と違う種類なら畳んだままでも分かるようにする
                          （複合図では系列ごとに違う印で描かれるため） */}
                      {series.type && series.type !== config.chartType && (
                        <span style={styles.seriesTypeTag}>{chartTypeLabel(series.type)}</span>
                      )}
                      {sourceNote && <span style={styles.seriesGone}> {sourceNote}</span>}
                    </span>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => moveSeries(i, -1)}
                      disabled={i === 0}
                      title={t("chart.moveUp")}
                    >
                      <ChevronUp size={13} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => moveSeries(i, 1)}
                      disabled={i === config.series.length - 1}
                      title={t("chart.moveDown")}
                    >
                      <ChevronDown size={13} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() => {
                        onChange({ series: config.series.filter((_, j) => j !== i) });
                        setExpandedSeries(null);
                      }}
                      title={t("chart.removeSeries")}
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </div>
                  {expanded && (
                    <div style={styles.seriesDetail}>
                      <label style={styles.fieldRow}>
                        <span style={styles.fieldLabel}>{t("chart.seriesLabel")}</span>
                        <input
                          type="text"
                          value={series.label ?? ""}
                          placeholder={series.yColumn}
                          onChange={(e) => updateSeries(i, { label: e.target.value })}
                          style={{ ...styles.input, flex: 1 }}
                        />
                      </label>

                      <div style={styles.assignLabel}>{t("chart.assignData")}</div>
                      <label style={styles.fieldRow}>
                        <span style={styles.fieldLabel}>{t("chart.source")}</span>
                        <select
                          value={series.sourceBlockId}
                          onChange={(e) => {
                            // 「素材のデータから選ぶ…」はホストのピッカーを開く。値は
                            // 確定時に付け替わるので、ここでは何も書き込まない
                            if (e.target.value === PICK_ASSET_OPTION) {
                              onPickAsset?.(i);
                              return;
                            }
                            updateSeries(
                              i,
                              retargetSeries(series, e.target.value, resolveTable(e.target.value))
                            );
                          }}
                          style={{ ...styles.select, flex: 1 }}
                        >
                          {!source && (
                            <option value={series.sourceBlockId}>
                              {isAssetSourceKey(series.sourceBlockId)
                                ? t("chart.seriesAssetGone")
                                : t("chart.seriesTableGone")}
                            </option>
                          )}
                          {tables.map(({ id, label, kind }) => (
                            <option key={id} value={id}>
                              {kind === "asset" ? t("chart.assetOptionLabel", { name: label }) : label}
                            </option>
                          ))}
                          {onPickAsset && (
                            <option value={PICK_ASSET_OPTION}>{t("chart.pickAssetOption")}</option>
                          )}
                        </select>
                      </label>
                      {!isHistogram && (
                        <label style={styles.fieldRow}>
                          <span style={styles.fieldLabel}>{t("chart.seriesX")}</span>
                          <select
                            value={series.xColumn}
                            onChange={(e) => updateSeries(i, { xColumn: e.target.value })}
                            style={{ ...styles.select, flex: 1 }}
                          >
                            {headers.map((h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label style={styles.fieldRow}>
                        <span style={styles.fieldLabel}>{t("chart.seriesY")}</span>
                        <select
                          value={series.yColumn}
                          onChange={(e) => updateSeries(i, { yColumn: e.target.value })}
                          style={{ ...styles.select, flex: 1 }}
                        >
                          {(isHistogram ? numericHeaders : headers).map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>

                      {!isHistogram && (
                        <label style={styles.fieldRow}>
                          <span style={styles.fieldLabel}>{t("chart.seriesType")}</span>
                          <select
                            value={series.type ?? ""}
                            onChange={(e) =>
                              updateSeries(i, {
                                type: (e.target.value || undefined) as SeriesType | undefined,
                              })
                            }
                            style={{ ...styles.select, flex: 1 }}
                          >
                            <option value="">{t("chart.typeFollowChart")}</option>
                            <option value="line">{t("chart.typeLine")}</option>
                            <option value="bar">{t("chart.typeBar")}</option>
                            <option value="scatter">{t("chart.typeScatter")}</option>
                          </select>
                        </label>
                      )}

                      {!isHistogram && (
                        <div style={styles.fieldRow}>
                          <span style={styles.fieldLabel}>{t("chart.seriesAxis")}</span>
                          <span style={styles.segment}>
                            {(["left", "right"] as const).map((axis) => {
                              const active = (series.axis ?? "left") === axis;
                              return (
                                <button
                                  key={axis}
                                  type="button"
                                  onClick={() => updateSeries(i, { axis })}
                                  style={{
                                    ...styles.segmentButton,
                                    ...(active ? styles.segmentButtonActive : {}),
                                  }}
                                >
                                  {axis === "left" ? t("chart.axisLeft") : t("chart.axisRight")}
                                </button>
                              );
                            })}
                          </span>
                        </div>
                      )}

                      {!isHistogram && config.stack.enabled && (
                        <>
                          <div style={styles.assignLabel}>{t("chart.stackSeriesSection")}</div>
                          <label style={styles.fieldRow}>
                            <span style={{ ...styles.fieldLabel, width: 76 }}>{t("chart.seriesScale")}</span>
                            {/*
                              入力中の "0." を数値に変換すると 0 に丸められて打てなくなるため、
                              確定は blur / Enter のとき。key は外から値が変わったときの同期用
                            */}
                            <input
                              key={`scale-${i}-${series.scale ?? ""}`}
                              type="text"
                              inputMode="decimal"
                              defaultValue={series.scale ?? ""}
                              placeholder="1"
                              onBlur={(e) =>
                                updateSeries(i, { scale: parseOptionalNumber(e.target.value, true) })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              style={{ ...styles.input, width: 72 }}
                            />
                          </label>
                          <label style={styles.fieldRow}>
                            <span style={{ ...styles.fieldLabel, width: 76 }}>{t("chart.seriesOffsetAdjust")}</span>
                            <input
                              key={`offset-${i}-${series.offsetAdjust ?? ""}`}
                              type="text"
                              inputMode="decimal"
                              defaultValue={series.offsetAdjust ?? ""}
                              placeholder="0"
                              onBlur={(e) =>
                                updateSeries(i, {
                                  offsetAdjust: parseOptionalNumber(e.target.value, false),
                                })
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              style={{ ...styles.input, width: 72 }}
                            />
                          </label>
                        </>
                      )}
                      <SeriesStyleEditor
                        series={series}
                        effectiveType={
                          isHistogram
                            ? "histogram"
                            : ((series.type ?? config.chartType) as SeriesType)
                        }
                        fallbackColor={CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length]}
                        onChange={(patch) => updateSeries(i, patch)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {config.series.length === 0 && (
              <div style={styles.emptyHint}>{t("chart.noNumericSeries")}</div>
            )}
          </div>
          <div style={styles.addSeriesRow}>
            <button type="button" onClick={addSeries} style={styles.addSeriesButton}>
              <Plus size={13} strokeWidth={2} />
              {t("chart.addSeries")}
            </button>
            {/* 素材（過去の測定・文献パターン）を系列にする入口。ノートに表を
                置かずに別のノートの生データを重ねる道なので、系列を足す操作の隣に置く */}
            {onPickAsset && (
              <button
                type="button"
                onClick={() => onPickAsset(null)}
                style={styles.addFromAssetButton}
                data-test="chart-add-series-from-asset"
              >
                <Database size={13} strokeWidth={2} />
                {t("chart.fromAsset")}
              </button>
            )}
          </div>
        </div>
      )}

      {tab === "axes" && (
        <div style={styles.body}>
          {!isHistogram && (
            <>
              <div style={styles.sectionLabel}>{t("chart.xAxis")}</div>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.axisName")}</span>
                <input
                  type="text"
                  value={config.xAxisName}
                  placeholder={t("chart.autoPlaceholder")}
                  onChange={(e) => onChange({ xAxisName: e.target.value })}
                  style={{ ...styles.input, flex: 1 }}
                />
              </label>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.axisKind")}</span>
                <select
                  value={config.xAxisKind}
                  onChange={(e) => onChange({ xAxisKind: e.target.value as XAxisKindSetting })}
                  style={{ ...styles.select, flex: 1 }}
                >
                  <option value="auto">{t("chart.kindAuto")}</option>
                  <option value="time">{t("chart.kindTime")}</option>
                  <option value="value">{t("chart.kindValue")}</option>
                  <option value="category">{t("chart.kindCategory")}</option>
                </select>
              </label>
              <label style={styles.fieldRow} title={effectiveXKind === "category" ? t("chart.minMaxCategoryHint") : undefined}>
                <span style={styles.fieldLabel}>{t("chart.minMax")}</span>
                <input
                  type="text"
                  value={config.xMin}
                  placeholder={effectiveXKind === "time" ? "2026-08-01" : t("chart.autoPlaceholder")}
                  disabled={effectiveXKind === "category"}
                  onChange={(e) => onChange({ xMin: e.target.value })}
                  style={{ ...styles.input, width: 88, opacity: effectiveXKind === "category" ? 0.5 : 1 }}
                />
                <span style={styles.rangeDash}>–</span>
                <input
                  type="text"
                  value={config.xMax}
                  placeholder={effectiveXKind === "time" ? "2026-08-31" : t("chart.autoPlaceholder")}
                  disabled={effectiveXKind === "category"}
                  onChange={(e) => onChange({ xMax: e.target.value })}
                  style={{ ...styles.input, width: 88, opacity: effectiveXKind === "category" ? 0.5 : 1 }}
                />
              </label>
              {/* なぜ入力できないのかを、その場で理由と抜け道つきで見せる */}
              {effectiveXKind === "category" && (
                <div style={{ ...styles.fieldHint, marginLeft: 54 }}>
                  {t("chart.minMaxCategoryHint")}
                </div>
              )}
              <AxisDetailEditor
                detail={config.xAxisDetail}
                onChange={(patch) => onChange({ xAxisDetail: { ...config.xAxisDetail, ...patch } })}
              />
            </>
          )}

          <div style={styles.sectionLabel}>
            {rightAxisInUse ? t("chart.yAxisLeft") : t("chart.yAxis")}
          </div>
          <label style={styles.fieldRow}>
            <span style={styles.fieldLabel}>{t("chart.axisName")}</span>
            <input
              type="text"
              value={config.yAxisName}
              placeholder={isHistogram ? t("chart.frequency") : t("chart.autoPlaceholder")}
              onChange={(e) => onChange({ yAxisName: e.target.value })}
              style={{ ...styles.input, flex: 1 }}
            />
          </label>
          <label style={styles.fieldRow}>
            <span style={styles.fieldLabel}>{t("chart.minMax")}</span>
            <input
              type="text"
              inputMode="decimal"
              value={config.yMin}
              placeholder={t("chart.autoPlaceholder")}
              onChange={(e) => onChange({ yMin: e.target.value })}
              style={{ ...styles.input, width: 72 }}
            />
            <span style={styles.rangeDash}>–</span>
            <input
              type="text"
              inputMode="decimal"
              value={config.yMax}
              placeholder={t("chart.autoPlaceholder")}
              onChange={(e) => onChange({ yMax: e.target.value })}
              style={{ ...styles.input, width: 72 }}
            />
          </label>
          <AxisDetailEditor
            detail={config.yAxisDetail}
            onChange={(patch) => onChange({ yAxisDetail: { ...config.yAxisDetail, ...patch } })}
            // 積み重ねは縦軸の目盛りを消す描き方なので、縦軸の詳細設定に同居させる
            stack={isHistogram ? undefined : config.stack}
            onStackChange={isHistogram ? undefined : updateStack}
          />

          {rightAxisInUse && (
            <>
              <div style={styles.sectionLabel}>{t("chart.yAxisRight")}</div>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.axisName")}</span>
                <input
                  type="text"
                  value={config.yRightAxisName}
                  placeholder={t("chart.autoPlaceholder")}
                  onChange={(e) => onChange({ yRightAxisName: e.target.value })}
                  style={{ ...styles.input, flex: 1 }}
                />
              </label>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.minMax")}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={config.yRightMin}
                  placeholder={t("chart.autoPlaceholder")}
                  onChange={(e) => onChange({ yRightMin: e.target.value })}
                  style={{ ...styles.input, width: 72 }}
                />
                <span style={styles.rangeDash}>–</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={config.yRightMax}
                  placeholder={t("chart.autoPlaceholder")}
                  onChange={(e) => onChange({ yRightMax: e.target.value })}
                  style={{ ...styles.input, width: 72 }}
                />
              </label>
              <AxisDetailEditor
                detail={config.yRightAxisDetail}
                onChange={(patch) =>
                  onChange({ yRightAxisDetail: { ...config.yRightAxisDetail, ...patch } })
                }
              />
            </>
          )}
        </div>
      )}

      {tab === "appearance" && (
        <div style={styles.body}>
          <div style={styles.sectionLabel}>{t("chart.caption")}</div>
          <input
            type="text"
            value={config.caption}
            placeholder={t("chart.captionPlaceholder")}
            onChange={(e) => onChange({ caption: e.target.value })}
            style={styles.input}
          />

          <div style={styles.sectionLabel}>{t("chart.aspect")}</div>
          <select
            value={config.aspect}
            onChange={(e) => onChange({ aspect: e.target.value as ChartAspect })}
            style={styles.select}
          >
            <option value="standard">{t("chart.aspectStandard")}</option>
            <option value="golden">{t("chart.aspectGolden")}</option>
            <option value="wide">{t("chart.aspectWide")}</option>
            <option value="panorama">{t("chart.aspectPanorama")}</option>
            <option value="ultrawide">{t("chart.aspectUltrawide")}</option>
            <option value="spectrum">{t("chart.aspectSpectrum")}</option>
            <option value="square">{t("chart.aspectSquare")}</option>
          </select>

          <div style={styles.sectionLabel}>{t("chart.legend")}</div>
          {/* 積み重ねの段名は通常の凡例の代わりに図の中へ出る。凡例の表示・位置は
              効かなくなるので、代わりに段名の置き場所を同じ並びで選ばせる
              （縦は段ごとに決まるぶん、選択肢は段の四隅） */}
          {inlineStackLabels ? (
            <>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.stackLabelPosition")}</span>
                <select
                  value={config.stack.labelPosition}
                  onChange={(e) =>
                    updateStack({ labelPosition: e.target.value as StackLabelPosition })
                  }
                  style={{ ...styles.select, flex: 1 }}
                >
                  {STACK_LABEL_POSITION_KEYS.map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key as any)}
                    </option>
                  ))}
                </select>
              </label>
              <div style={styles.fieldHint}>{t("chart.stackLabelPositionHint")}</div>
            </>
          ) : (
            <label style={styles.checkRow}>
              <input
                type="checkbox"
                checked={config.showLegend}
                onChange={(e) => onChange({ showLegend: e.target.checked })}
              />
              {t("chart.show")}
            </label>
          )}
          {config.showLegend && !inlineStackLabels && (
            <>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.legendPosition")}</span>
                <select
                  value={config.legendPosition}
                  onChange={(e) => onChange({ legendPosition: e.target.value as LegendPosition })}
                  style={{ ...styles.select, flex: 1 }}
                >
                  {LEGEND_POSITION_KEYS.map(([value, key]) => (
                    <option key={value} value={value}>
                      {t(key as any)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.legendOrient")}</span>
                <span style={styles.segment}>
                  {(["horizontal", "vertical"] as const).map((orient) => {
                    const active = config.legendOrient === orient;
                    return (
                      <button
                        key={orient}
                        type="button"
                        onClick={() => onChange({ legendOrient: orient })}
                        style={{
                          ...styles.segmentButton,
                          ...(active ? styles.segmentButtonActive : {}),
                        }}
                      >
                        {orient === "horizontal"
                          ? t("chart.orientHorizontal")
                          : t("chart.orientVertical")}
                      </button>
                    );
                  })}
                </span>
              </label>
            </>
          )}

          <div style={styles.sectionLabel}>{t("chart.frame")}</div>
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={config.showFrame}
              onChange={(e) => onChange({ showFrame: e.target.checked })}
            />
            {t("chart.show")}
          </label>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: "absolute",
    top: 28,
    right: 0,
    width: 300,
    maxHeight: 440,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    borderRadius: 8,
    border: "1px solid var(--color-border-subtle)",
    // すりガラス: パネルはチャートに重なるので、下の図がうっすら透けて
    // 設定変更の結果を追える程度の透明度を持たせる
    background: "rgba(255, 255, 255, 0.85)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    boxShadow: "var(--shadow-2)",
    zIndex: 60,
    padding: 12,
    gap: 8,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--color-foreground)",
  },
  closeButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
  },
  tabBar: {
    display: "flex",
    gap: 4,
  },
  tab: {
    padding: "3px 10px",
    fontSize: 12,
    borderRadius: 999,
    border: "none",
    background: "transparent",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  tabActive: {
    background: "var(--color-foreground)",
    color: "var(--color-surface)",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sectionLabel: {
    marginTop: 6,
    fontSize: 11,
    color: "var(--color-text-tertiary)",
  },
  assignLabel: {
    marginTop: 4,
    fontSize: 11,
    color: "var(--color-text-tertiary)",
  },
  select: {
    width: "100%",
    padding: "4px 8px",
    fontSize: 13,
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
  },
  input: {
    width: "100%",
    padding: "4px 8px",
    fontSize: 13,
    borderRadius: 6,
    border: "1px solid var(--color-input)",
    background: "var(--color-card)",
    color: "var(--color-foreground)",
    outline: "none",
  },
  fieldRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  fieldLabel: {
    flexShrink: 0,
    width: 48,
    fontSize: 12,
    color: "var(--color-text-secondary)",
  },
  rangeDash: {
    color: "var(--color-text-tertiary)",
    fontSize: 12,
  },
  // 設定の下に添える注記（無効な理由・別の設定への案内）
  fieldHint: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "var(--color-text-tertiary)",
  },
  checkRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--color-foreground)",
    cursor: "pointer",
  },
  seriesList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  seriesItem: {
    display: "flex",
    flexDirection: "column",
  },
  seriesRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 4px",
    borderRadius: 6,
  },
  seriesDetail: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    margin: "2px 0 6px 24px",
    padding: "8px 8px",
    borderRadius: 6,
    background: "var(--color-muted)",
  },
  swatch: {
    flexShrink: 0,
    width: 14,
    height: 10,
    borderRadius: 2,
  },
  seriesName: {
    flex: 1,
    fontSize: 13,
    color: "var(--color-foreground)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  seriesGone: {
    fontSize: 11,
    color: "var(--color-error, #c26356)",
  },
  // 系列名の後ろに添える種類タグ（チャート全体の種類を上書きしているときだけ）
  seriesTypeTag: {
    marginLeft: 6,
    padding: "0 5px",
    borderRadius: 4,
    background: "var(--color-surface-hover)",
    fontSize: 10,
    color: "var(--color-text-tertiary)",
  },
  iconButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 20,
    height: 20,
    borderRadius: 4,
    border: "none",
    background: "transparent",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
  },
  addSeriesRow: {
    display: "flex",
    gap: 6,
    marginTop: 2,
  },
  addSeriesButton: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 0,
    padding: "5px 0",
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    background: "var(--color-foreground)",
    color: "var(--color-surface)",
    cursor: "pointer",
  },
  // 素材から足す方は二次ボタン（枠線だけ）。主役はノート内テーブルの追加のまま
  addFromAssetButton: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    minWidth: 0,
    padding: "5px 0",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  colorSwatchButton: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: "1px solid rgba(0,0,0,0.12)",
    cursor: "pointer",
    padding: 0,
  },
  segment: {
    display: "inline-flex",
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    overflow: "hidden",
  },
  segmentButton: {
    padding: "2px 12px",
    fontSize: 12,
    border: "none",
    background: "var(--color-card)",
    color: "var(--color-text-tertiary)",
    cursor: "pointer",
  },
  segmentButtonActive: {
    background: "var(--color-foreground)",
    color: "var(--color-surface)",
  },
  emptyHint: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    padding: "2px 4px",
  },
};
