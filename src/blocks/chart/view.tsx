// チャートブロック
//
// ノート内のテーブル（記録テーブル含む）を参照して ECharts で描画する。
// eureco のチャートブロックを参考にしつつ、v1 は「ノート内テーブル 1 つ」に
// 絞る（複数ソース統合・CSV・集計パイプラインは持ち込まない）。
//
// 設計メモ:
// - データはあくまでテーブル側が真実。チャートは props（参照列名・種別）だけを
//   持ち、テーブル編集には editor.onChange 経由で追従する
// - 列は index でなく「列名」で参照する（列の挿入・並べ替えに強い。
//   index-table がサンプル名キーで行を参照するのと同じ思想）
// - ECharts は初描画時に dynamic import（echarts-loader.ts）。SVG レンダラ
// - 参照切れ（テーブル削除・列名変更）はエラーにせずプレースホルダに退避する

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChartSpline } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t } from "../../i18n";
import {
  buildChartData,
  readTableData,
  suggestConfig,
  isNumericColumn,
  type ChartDataResult,
  type ChartType,
  type TableData,
} from "./chart-data";
import { loadECharts } from "./echarts-loader";
import { CHART_SERIES_COLORS, readChartUiColors } from "./chart-theme";

const CHART_TYPES: ChartType[] = ["line", "bar", "scatter", "histogram"];

function chartTypeLabel(type: ChartType): string {
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

/** props.yColumns（JSON 文字列）→ 列名配列 */
function parseYColumns(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string");
  } catch {
    // 旧形式・手書きの保険としてカンマ区切りも読む
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

/** ノート内の table ブロックを（文書順で）集める */
function collectTables(editor: any): Array<{ id: string; label: string }> {
  const result: Array<{ id: string; label: string }> = [];
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (b?.type === "table") {
        const data = readTableData(b);
        const label = (data?.headers ?? []).filter(Boolean).join(" | ");
        result.push({
          id: b.id,
          label: label.length > 48 ? `${label.slice(0, 48)}…` : label || t("chart.table"),
        });
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor?.document ?? []);
  return result;
}

export const ChartBlock = createReactBlockSpec(
  {
    type: "chart" as const,
    propSchema: {
      /** 参照先テーブルの blockId */
      sourceBlockId: { default: "" },
      chartType: { default: "line" },
      /** X 軸に使う列名（histogram では対象の数値列） */
      xColumn: { default: "" },
      /** 系列にする列名の JSON 配列文字列 */
      yColumns: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: (props) => <ChartBlockView {...(props as any)} />,
  }
);

function ChartBlockView({ block, editor }: { block: any; editor: any }) {
  const editable = (editor as any).isEditable !== false;
  const sourceBlockId = String(block.props.sourceBlockId ?? "");
  const chartType = (CHART_TYPES as string[]).includes(String(block.props.chartType))
    ? (String(block.props.chartType) as ChartType)
    : "line";
  const xColumn = String(block.props.xColumn ?? "");
  const yColumns = useMemo(() => parseYColumns(String(block.props.yColumns ?? "")), [block.props.yColumns]);

  // テーブル編集への追従: onChange をデバウンスして再読込カウンタを進める
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    const timer = { id: 0 as number | 0 };
    const unsub = (editor as any).onChange?.(() => {
      if (timer.id) window.clearTimeout(timer.id);
      timer.id = window.setTimeout(() => setDocVersion((v) => v + 1), 300);
    });
    return () => {
      if (timer.id) window.clearTimeout(timer.id);
      if (typeof unsub === "function") unsub();
    };
  }, [editor]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => collectTables(editor), [editor, docVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sourceBlock = useMemo(
    () => (sourceBlockId ? (editor as any).getBlock?.(sourceBlockId) : null),
    [editor, sourceBlockId, docVersion]
  );
  const tableData: TableData | null = useMemo(() => readTableData(sourceBlock), [sourceBlock]);

  const updateProps = (patch: Record<string, string>) => {
    (editor as any).updateBlock(block, { props: { ...block.props, ...patch } });
  };

  const selectSource = (id: string) => {
    const b = (editor as any).getBlock?.(id);
    const data = readTableData(b);
    if (!data) return;
    const suggested = suggestConfig(data);
    updateProps({
      sourceBlockId: id,
      xColumn: suggested.xColumn,
      yColumns: JSON.stringify(suggested.yColumns),
    });
  };

  // ── 未設定: テーブル選択プレースホルダ ──
  if (!sourceBlockId) {
    return (
      <div data-test="chart-block" contentEditable={false} style={styles.placeholderShell}>
        <div style={styles.placeholderTitle}>
          <ChartSpline size={15} strokeWidth={2} />
          {t("chart.selectSource")}
        </div>
        {tables.length === 0 ? (
          <div style={styles.placeholderEmpty}>{t("chart.noTables")}</div>
        ) : (
          <div style={styles.tableList}>
            {tables.map(({ id, label }) => (
              <button key={id} type="button" style={styles.tableButton} onClick={() => selectSource(id)} disabled={!editable}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── 参照切れ ──
  if (!tableData) {
    return (
      <div data-test="chart-block" contentEditable={false} style={styles.placeholderShell}>
        <div style={styles.placeholderTitle}>
          <ChartSpline size={15} strokeWidth={2} />
          {t("chart.sourceGone")}
        </div>
        {editable && (
          <div style={styles.tableList}>
            {tables.map(({ id, label }) => (
              <button key={id} type="button" style={styles.tableButton} onClick={() => selectSource(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const config = { chartType, xColumn, yColumns };
  const result = buildChartData(tableData, config);

  return (
    <div data-test="chart-block" contentEditable={false} style={styles.shell}>
      {editable && (
        <div style={styles.settingsBar}>
          <select
            value={sourceBlockId}
            onChange={(e) => selectSource(e.target.value)}
            style={styles.select}
            title={t("chart.table")}
          >
            {tables.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={chartType}
            onChange={(e) => updateProps({ chartType: e.target.value })}
            style={styles.select}
            title={t("chart.chartType")}
          >
            {CHART_TYPES.map((type) => (
              <option key={type} value={type}>
                {chartTypeLabel(type)}
              </option>
            ))}
          </select>
          <label style={styles.axisLabel}>
            {t("chart.xAxis")}
            <select
              value={xColumn}
              onChange={(e) => updateProps({ xColumn: e.target.value })}
              style={styles.select}
            >
              {tableData.headers.filter((h) => h.trim() !== "").map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </label>
          {chartType !== "histogram" && (
            <span style={styles.seriesGroup}>
              <span style={styles.axisLabelText}>{t("chart.series")}</span>
              {tableData.headers
                .filter((h) => h.trim() !== "" && h !== xColumn && isNumericColumn(tableData, h))
                .map((h) => {
                  const checked = yColumns.includes(h);
                  return (
                    <label key={h} style={styles.seriesCheck}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? yColumns.filter((c) => c !== h)
                            : [...yColumns, h];
                          updateProps({ yColumns: JSON.stringify(next) });
                        }}
                      />
                      {h}
                    </label>
                  );
                })}
            </span>
          )}
        </div>
      )}
      {result.kind === "ok" ? (
        <ChartCanvas result={result} chartType={chartType} />
      ) : (
        <div style={styles.emptyState}>
          {result.kind === "empty" ? t("chart.noData") : t("chart.noNumericSeries")}
        </div>
      )}
    </div>
  );
}

/** ECharts の option を組み立てる（描画状態を持たない純粋な変換） */
function buildOption(result: Extract<ChartDataResult, { kind: "ok" }>, chartType: ChartType): any {
  const ui = readChartUiColors();
  const axisCommon = {
    axisLine: { lineStyle: { color: ui.line } },
    axisLabel: { color: ui.text, fontSize: 11 },
    splitLine: { lineStyle: { color: ui.line } },
  };
  const seriesType = chartType === "histogram" ? "bar" : chartType;
  return {
    color: CHART_SERIES_COLORS,
    animation: false,
    grid: { left: 44, right: 16, top: result.series.length > 1 ? 34 : 16, bottom: 28 },
    tooltip: {
      trigger: chartType === "scatter" ? "item" : "axis",
      textStyle: { fontSize: 12 },
    },
    legend:
      result.series.length > 1
        ? { top: 4, textStyle: { color: ui.text, fontSize: 11 } }
        : undefined,
    xAxis:
      result.xAxis === "category"
        ? { type: "category", data: result.categories, ...axisCommon }
        : { type: result.xAxis, ...axisCommon },
    yAxis: { type: "value", ...axisCommon },
    series: result.series.map((s) => ({
      name: s.name,
      type: seriesType,
      data: s.points,
      connectNulls: false,
      symbolSize: chartType === "scatter" ? 8 : 6,
      barMaxWidth: 40,
    })),
  };
}

function ChartCanvas({
  result,
  chartType,
}: {
  result: Extract<ChartDataResult, { kind: "ok" }>;
  chartType: ChartType;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    loadECharts()
      .then((ec) => {
        if (disposed || !ref.current) return;
        const chart = ec.init(ref.current, undefined, { renderer: "svg" });
        chartRef.current = chart;
        observer = new ResizeObserver(() => chart.resize());
        observer.observe(ref.current);
        setReady(true);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !chartRef.current) return;
    chartRef.current.setOption(buildOption(result, chartType), true);
  }, [ready, result, chartType]);

  if (failed) {
    return <div style={styles.emptyState}>{t("chart.noData")}</div>;
  }
  return (
    <div style={{ position: "relative", width: "100%" }}>
      {!ready && <div style={styles.loading}>{t("chart.loading")}</div>}
      <div ref={ref} style={{ width: "100%", height: 320 }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    width: "100%",
    padding: "8px 4px",
  },
  settingsBar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },
  select: {
    maxWidth: 180,
    padding: "2px 6px",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
  },
  axisLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  axisLabelText: {
    color: "var(--color-text-tertiary)",
  },
  seriesGroup: {
    display: "inline-flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  seriesCheck: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 6px",
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  placeholderShell: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: "100%",
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px dashed var(--color-border-subtle)",
    background: "var(--color-muted)",
  },
  placeholderTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--color-text-secondary)",
  },
  placeholderEmpty: {
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },
  tableList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  tableButton: {
    padding: "3px 10px",
    fontSize: 12,
    borderRadius: 6,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  },
  emptyState: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 120,
    fontSize: 13,
    color: "var(--color-text-tertiary)",
  },
  loading: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    color: "var(--color-text-tertiary)",
  },
};
