// チャート設定パネル
//
// eureco の「チャートの設定」ポップオーバーに合わせたタブ式パネル。
// タブ構成（種類・系列 / 軸設定 / 外観）は eureco 作者のこだわりで、
// 系列の並べ替え・削除・追加、軸名と min/max、キャプション・アスペクト比・
// 凡例・枠線という項目立てもそれに倣う。
// UI ニュートラル色は design.md のトークン、寸法は 8pt 格子から。

import { useMemo, useState } from "react";
import { X, ChevronUp, ChevronDown } from "lucide-react";
import { t } from "../../i18n";
import { isNumericColumn, type TableData } from "./chart-data";
import type { ChartType } from "./chart-data";
import { CHART_SERIES_COLORS } from "./chart-theme";
import type { ChartBlockConfig, LegendPosition } from "./chart-config";
import type { ChartAspect } from "./chart-theme";

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

export function ChartSettingsPanel({
  config,
  onChange,
  tables,
  sourceBlockId,
  onSelectSource,
  tableData,
  onClose,
}: {
  config: ChartBlockConfig;
  onChange: (patch: Partial<ChartBlockConfig>) => void;
  tables: Array<{ id: string; label: string }>;
  sourceBlockId: string;
  onSelectSource: (id: string) => void;
  tableData: TableData | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("typeSeries");

  const columns = useMemo(
    () => (tableData?.headers ?? []).filter((h) => h.trim() !== ""),
    [tableData]
  );
  const numericColumns = useMemo(
    () => (tableData ? columns.filter((h) => isNumericColumn(tableData, h)) : []),
    [tableData, columns]
  );
  const addableSeries = numericColumns.filter(
    (h) => h !== config.xColumn && !config.yColumns.includes(h)
  );

  const moveSeries = (index: number, delta: number) => {
    const next = [...config.yColumns];
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange({ yColumns: next });
  };

  return (
    <div style={styles.panel} data-test="chart-settings">
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
          <div style={styles.sectionLabel}>{t("chart.sectionData")}</div>
          <select
            value={sourceBlockId}
            onChange={(e) => onSelectSource(e.target.value)}
            style={styles.select}
            title={t("chart.table")}
          >
            {tables.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>

          <div style={styles.sectionLabel}>{t("chart.sectionType")}</div>
          <select
            value={config.chartType}
            onChange={(e) => {
              const chartType = e.target.value as ChartType;
              // histogram は対象列が数値列である必要がある。数値列でなければ先頭の数値列へ
              if (chartType === "histogram" && !numericColumns.includes(config.xColumn)) {
                onChange({ chartType, xColumn: numericColumns[0] ?? config.xColumn });
              } else {
                onChange({ chartType });
              }
            }}
            style={styles.select}
          >
            {CHART_TYPES.map((type) => (
              <option key={type} value={type}>
                {chartTypeLabel(type)}
              </option>
            ))}
          </select>

          {config.chartType === "histogram" ? (
            <>
              <div style={styles.sectionLabel}>{t("chart.histogramColumn")}</div>
              <select
                value={config.xColumn}
                onChange={(e) => onChange({ xColumn: e.target.value })}
                style={styles.select}
              >
                {numericColumns.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <div style={styles.sectionLabel}>{t("chart.sectionSeries")}</div>
              <div style={styles.seriesList}>
                {config.yColumns.map((name, i) => (
                  <div key={name} style={styles.seriesRow}>
                    <span
                      style={{
                        ...styles.swatch,
                        background: CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
                      }}
                    />
                    <span style={styles.seriesName}>{name}</span>
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
                      disabled={i === config.yColumns.length - 1}
                      title={t("chart.moveDown")}
                    >
                      <ChevronDown size={13} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      style={styles.iconButton}
                      onClick={() =>
                        onChange({ yColumns: config.yColumns.filter((c) => c !== name) })
                      }
                      title={t("chart.removeSeries")}
                    >
                      <X size={13} strokeWidth={2} />
                    </button>
                  </div>
                ))}
                {config.yColumns.length === 0 && (
                  <div style={styles.emptyHint}>{t("chart.noNumericSeries")}</div>
                )}
              </div>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) onChange({ yColumns: [...config.yColumns, e.target.value] });
                }}
                style={{ ...styles.select, color: "var(--color-text-tertiary)" }}
                disabled={addableSeries.length === 0}
              >
                <option value="">{t("chart.addSeries")}</option>
                {addableSeries.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      )}

      {tab === "axes" && (
        <div style={styles.body}>
          {config.chartType !== "histogram" && (
            <>
              <div style={styles.sectionLabel}>{t("chart.xAxis")}</div>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.column")}</span>
                <select
                  value={config.xColumn}
                  onChange={(e) => onChange({ xColumn: e.target.value })}
                  style={{ ...styles.select, flex: 1 }}
                >
                  {columns.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
              <label style={styles.fieldRow}>
                <span style={styles.fieldLabel}>{t("chart.axisName")}</span>
                <input
                  type="text"
                  value={config.xAxisName}
                  placeholder={config.xColumn || t("chart.autoPlaceholder")}
                  onChange={(e) => onChange({ xAxisName: e.target.value })}
                  style={{ ...styles.input, flex: 1 }}
                />
              </label>
            </>
          )}

          <div style={styles.sectionLabel}>{t("chart.yAxis")}</div>
          <label style={styles.fieldRow}>
            <span style={styles.fieldLabel}>{t("chart.axisName")}</span>
            <input
              type="text"
              value={config.yAxisName}
              placeholder={
                config.chartType === "histogram"
                  ? t("chart.frequency")
                  : config.yColumns.length === 1
                    ? config.yColumns[0]
                    : t("chart.autoPlaceholder")
              }
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

          <div style={styles.sectionLabel}>{t("chart.displayElements")}</div>
          <label style={styles.checkRow}>
            <input
              type="checkbox"
              checked={config.showGrid}
              onChange={(e) => onChange({ showGrid: e.target.checked })}
            />
            {t("chart.gridLines")}
          </label>
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
            <option value="wide">{t("chart.aspectWide")}</option>
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
            <label style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{t("chart.legendPosition")}</span>
              <select
                value={config.legendPosition}
                onChange={(e) => onChange({ legendPosition: e.target.value as LegendPosition })}
                style={{ ...styles.select, flex: 1 }}
              >
                <option value="top-left">{t("chart.posTopLeft")}</option>
                <option value="top-right">{t("chart.posTopRight")}</option>
                <option value="bottom">{t("chart.posBottom")}</option>
              </select>
            </label>
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
    width: 288,
    maxHeight: 420,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    borderRadius: 8,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
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
    width: 44,
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
  seriesRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 4px",
    borderRadius: 6,
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
  emptyHint: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
    padding: "2px 4px",
  },
};
