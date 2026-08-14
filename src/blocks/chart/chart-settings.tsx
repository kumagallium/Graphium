// チャート設定パネル
//
// eureco の「チャートの設定」ポップオーバーに合わせたタブ式パネル。
// タブは思考順序（何を見るか → スケール → 体裁）で、データの割り当て
//（どのテーブルの・どの列か）は「何を見るか」なので種類・系列タブが持つ。
// 系列は行を開くと個別設定（名前・データの割り当て・種類・色・軸）になる。
// UI ニュートラル色は design.md のトークン、寸法は 8pt 格子から。

import { useMemo, useState } from "react";
import { X, ChevronUp, ChevronDown, ChevronRight, Palette, Plus } from "lucide-react";
import { t } from "../../i18n";
import { detectXAxisKind, isNumericColumn, type TableData } from "./chart-data";
import type { ChartType } from "./chart-data";
import { CHART_SERIES_COLORS } from "./chart-theme";
import {
  resolveSeriesStyle,
  seriesConfigDisplayName,
  usesRightAxis,
  type AxisDetail,
  type ChartBlockConfig,
  type ChartSeriesConfig,
  type LegendPosition,
  type SeriesBarWidth,
  type SeriesLineType,
  type SeriesLineWidth,
  type SeriesSymbolShape,
  type SeriesSymbolSize,
  type SeriesType,
  type XAxisKindSetting,
} from "./chart-config";
import type { ChartAspect } from "./chart-theme";

/** 設定パネル内のトグルスイッチ（settings/modal.tsx の switch と同じ見た目） */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
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
        cursor: "pointer",
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
 * 軸ごとの「詳細設定」（eureco 準拠の折りたたみ）:
 * 軸・軸線・目盛り・目盛りラベルの表示、ラベルの回転、目盛りの向き、グリッド。
 */
function AxisDetailEditor({
  detail,
  onChange,
}: {
  detail: AxisDetail;
  onChange: (patch: Partial<AxisDetail>) => void;
}) {
  const [open, setOpen] = useState(false);
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
            <span style={detailStyles.label}>{t("chart.ticksShow")}</span>
            <Toggle checked={detail.showTicks} onChange={(v) => onChange({ showTicks: v })} />
          </div>
          <div style={detailStyles.row}>
            <span style={detailStyles.label}>{t("chart.tickLabelsShow")}</span>
            <Toggle checked={detail.showLabels} onChange={(v) => onChange({ showLabels: v })} />
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
            <span style={detailStyles.label}>{t("chart.gridShow")}</span>
            <Toggle checked={detail.showGrid} onChange={(v) => onChange({ showGrid: v })} />
          </div>
        </div>
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

/** テーブルを替えたとき、同名列が無ければ新テーブルの妥当な列に付け替える */
function retargetSeries(
  series: ChartSeriesConfig,
  newBlockId: string,
  table: TableData | null
): ChartSeriesConfig {
  if (!table) return { ...series, sourceBlockId: newBlockId };
  const headers = table.headers.filter((h) => h.trim() !== "");
  const numeric = headers.filter((h) => isNumericColumn(table, h));
  const xColumn = headers.includes(series.xColumn) ? series.xColumn : (table.headers[0] ?? "");
  const yColumn = numeric.includes(series.yColumn)
    ? series.yColumn
    : (numeric.find((h) => h !== xColumn) ?? numeric[0] ?? "");
  return { ...series, sourceBlockId: newBlockId, xColumn, yColumn };
}

export function ChartSettingsPanel({
  config,
  onChange,
  tables,
  resolveTable,
  placement = "overlay",
  onClose,
}: {
  config: ChartBlockConfig;
  onChange: (patch: Partial<ChartBlockConfig>) => void;
  tables: Array<{ id: string; label: string }>;
  resolveTable: (blockId: string) => TableData | null;
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
    if (config.chartType === "bar" || config.chartType === "histogram") return "category";
    if (config.xAxisKind !== "auto") return config.xAxisKind;
    const xValues = config.series.flatMap((s) => {
      const table = resolveTable(s.sourceBlockId);
      if (!table) return [];
      const idx = table.headers.findIndex((h) => h.trim() === s.xColumn.trim());
      if (idx < 0) return [];
      return table.rows.map((r) => r[idx] ?? "");
    });
    return detectXAxisKind(xValues);
  }, [config.chartType, config.xAxisKind, config.series, resolveTable]);

  const updateSeries = (index: number, patch: Partial<ChartSeriesConfig>) => {
    const next = config.series.map((s, i) => (i === index ? { ...s, ...patch } : s));
    onChange({ series: next });
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

          <div style={styles.sectionLabel}>{t("chart.sectionSeries")}</div>
          <div style={styles.seriesList}>
            {config.series.map((series, i) => {
              const color = series.color || CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
              const expanded = expandedSeries === i;
              const table = resolveTable(series.sourceBlockId);
              const headers = (table?.headers ?? []).filter((h) => h.trim() !== "");
              const numericHeaders = table ? headers.filter((h) => isNumericColumn(table, h)) : [];
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
                      {!table && (
                        <span style={styles.seriesGone}> {t("chart.seriesTableGone")}</span>
                      )}
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
                        <span style={styles.fieldLabel}>{t("chart.table")}</span>
                        <select
                          value={series.sourceBlockId}
                          onChange={(e) =>
                            updateSeries(
                              i,
                              retargetSeries(series, e.target.value, resolveTable(e.target.value))
                            )
                          }
                          style={{ ...styles.select, flex: 1 }}
                        >
                          {!tables.some(({ id }) => id === series.sourceBlockId) && (
                            <option value={series.sourceBlockId}>
                              {t("chart.seriesTableGone")}
                            </option>
                          )}
                          {tables.map(({ id, label }) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
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
          <button type="button" onClick={addSeries} style={styles.addSeriesButton}>
            <Plus size={13} strokeWidth={2} />
            {t("chart.addSeries")}
          </button>
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
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={config.showLegend}
              onChange={(e) => onChange({ showLegend: e.target.checked })}
            />
            {t("chart.show")}
          </label>
          {config.showLegend && (
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
  addSeriesButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    width: "100%",
    padding: "5px 0",
    marginTop: 2,
    fontSize: 12,
    borderRadius: 6,
    border: "none",
    background: "var(--color-foreground)",
    color: "var(--color-surface)",
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
