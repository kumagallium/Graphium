// チャートブロック
//
// ノート内のテーブル（記録テーブル含む）を参照して ECharts で描画する。
// 見た目と設定 UI は eureco のチャートブロック（作者のこだわり: 学術分野でも
// 違和感が少ない図・タブ式の設定）に合わせる。詳細は chart-theme.ts 冒頭を参照。
//
// 設計メモ:
// - データはあくまでテーブル側が真実。チャートは props（参照 blockId + 設定 JSON）
//   だけを持ち、テーブル編集には editor.onChange 経由で追従する
// - 列は index でなく「列名」で参照する（列の挿入・並べ替えに強い）
// - ECharts は初描画時に dynamic import（echarts-loader.ts）。SVG レンダラ
// - 参照切れ（テーブル削除・列名変更）はエラーにせずプレースホルダに退避する
// - アスペクト比は幅から高さを算出（標準 √2:1 = A 判、eureco と同じ）

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChartSpline, SlidersHorizontal } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { t } from "../../i18n";
import {
  buildChartData,
  parseNumeric,
  readTableData,
  suggestConfig,
  type ChartDataResult,
  type TableData,
} from "./chart-data";
import { loadECharts } from "./echarts-loader";
import {
  CHART_ASPECT_RATIOS,
  CHART_AXIS_LINE_WIDTH,
  CHART_FONT_SIZE,
  CHART_FRAME,
  CHART_FRAME_WIDTH,
  CHART_GRID_LINE,
  CHART_INK,
  CHART_LEGEND_ITEM,
  CHART_SERIES_COLORS,
  CHART_TICK_LENGTH,
} from "./chart-theme";
import {
  parseChartBlockConfig,
  serializeChartBlockConfig,
  type ChartBlockConfig,
} from "./chart-config";
import { ChartSettingsPanel } from "./chart-settings";

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
      /** 設定一式（ChartBlockConfig の JSON。chart-config.ts が正） */
      config: { default: "" },
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
  const config = useMemo(
    () => parseChartBlockConfig(String(block.props.config ?? "")),
    [block.props.config]
  );

  const [showSettings, setShowSettings] = useState(false);
  // 設定ボタン + パネルのアンカー。外側クリック判定はこの要素基準で行う
  // （ブロック全体を基準にするとチャート上のクリックで閉じなくなる）
  const settingsAnchorRef = useRef<HTMLDivElement>(null);

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

  // 設定パネルの外側クリックで閉じる
  useEffect(() => {
    if (!showSettings) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (settingsAnchorRef.current?.contains(target)) return;
      setShowSettings(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSettings]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => collectTables(editor), [editor, docVersion]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sourceBlock = useMemo(
    () => (sourceBlockId ? (editor as any).getBlock?.(sourceBlockId) : null),
    [editor, sourceBlockId, docVersion]
  );
  const tableData: TableData | null = useMemo(() => readTableData(sourceBlock), [sourceBlock]);

  const updateConfig = (patch: Partial<ChartBlockConfig>) => {
    (editor as any).updateBlock(block, {
      props: {
        ...block.props,
        config: serializeChartBlockConfig({ ...config, ...patch }),
      },
    });
  };

  // 参照テーブルはあるのに列が未設定（挿入直後や設定の欠け）なら一度だけ自動推定する。
  // suggest の xColumn はヘッダ 1 列目なので、適用されれば必ず非空になり再発火しない
  useEffect(() => {
    if (!editable || !tableData || config.xColumn !== "") return;
    const suggested = suggestConfig(tableData);
    if (!suggested.xColumn) return;
    updateConfig({ xColumn: suggested.xColumn, yColumns: suggested.yColumns });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, tableData, config.xColumn]);

  const selectSource = (id: string) => {
    const b = (editor as any).getBlock?.(id);
    const data = readTableData(b);
    if (!data) return;
    const suggested = suggestConfig(data);
    (editor as any).updateBlock(block, {
      props: {
        sourceBlockId: id,
        config: serializeChartBlockConfig({
          ...config,
          xColumn: suggested.xColumn,
          yColumns: suggested.yColumns,
        }),
      },
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

  const result = buildChartData(tableData, {
    chartType: config.chartType,
    xColumn: config.xColumn,
    yColumns: config.yColumns,
  });

  return (
    <div data-test="chart-block" contentEditable={false} style={styles.shell}>
      {editable && (
        <div ref={settingsAnchorRef} style={styles.settingsAnchor}>
          <button
            type="button"
            onClick={() => setShowSettings((v) => !v)}
            style={styles.settingsButton}
            title={t("chart.settingsTitle")}
          >
            <SlidersHorizontal size={13} strokeWidth={2} />
            {t("chart.settings")}
          </button>
          {showSettings && (
            <ChartSettingsPanel
              config={config}
              onChange={updateConfig}
              tables={tables}
              sourceBlockId={sourceBlockId}
              onSelectSource={selectSource}
              tableData={tableData}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
      )}
      {result.kind === "ok" ? (
        <ChartCanvas result={result} config={config} />
      ) : (
        <div style={styles.emptyState}>
          {result.kind === "empty" ? t("chart.noData") : t("chart.noNumericSeries")}
        </div>
      )}
      {config.caption.trim() !== "" && <div style={styles.caption}>{config.caption}</div>}
    </div>
  );
}

/**
 * ECharts の option を組み立てる（eureco の学術スタイル、chart-theme.ts の実測値）。
 * 描画状態を持たない純粋な変換。
 */
function buildOption(
  result: Extract<ChartDataResult, { kind: "ok" }>,
  config: ChartBlockConfig
): any {
  const isHistogram = config.chartType === "histogram";
  const xName = config.xAxisName.trim() || (isHistogram ? config.xColumn : config.xColumn);
  const yName =
    config.yAxisName.trim() ||
    (isHistogram
      ? t("chart.frequency")
      : result.series.length === 1
        ? result.series[0].name
        : "");
  const yMin = parseNumeric(config.yMin);
  const yMax = parseNumeric(config.yMax);
  const legendTop = config.showLegend && config.legendPosition !== "bottom";
  const legendBottom = config.showLegend && config.legendPosition === "bottom";

  const fontFamily =
    typeof window !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";

  const axisCommon = {
    axisLine: {
      show: true,
      lineStyle: { width: CHART_AXIS_LINE_WIDTH, color: CHART_FRAME },
    },
    axisTick: {
      show: true,
      length: CHART_TICK_LENGTH,
      inside: true,
      lineStyle: { color: CHART_FRAME },
    },
    axisLabel: { fontSize: CHART_FONT_SIZE, color: CHART_INK },
    splitLine: config.showGrid
      ? { show: true, lineStyle: { ...CHART_GRID_LINE, color: "#cccccc" } }
      : { show: false },
    nameLocation: "middle" as const,
    nameTextStyle: { fontSize: CHART_FONT_SIZE, color: CHART_INK },
    z: 3,
  };

  const seriesType = isHistogram ? "bar" : config.chartType;

  return {
    animation: false,
    textStyle: { fontFamily, fontSize: CHART_FONT_SIZE, color: CHART_INK },
    grid: {
      show: config.showFrame,
      borderColor: CHART_FRAME,
      borderWidth: CHART_FRAME_WIDTH,
      z: 10,
      left: yName ? 84 : 60,
      right: 24,
      top: legendTop ? 48 : 20,
      bottom: (xName ? 64 : 40) + (legendBottom ? 32 : 0),
    },
    tooltip: {
      trigger: config.chartType === "scatter" ? "item" : "axis",
      axisPointer: {
        type: "line",
        lineStyle: { width: 0.8, type: "dashed" },
        z: 2,
      },
      textStyle: { fontSize: 13 },
    },
    legend: config.showLegend
      ? {
          show: true,
          orient: "horizontal",
          ...(config.legendPosition === "top-left"
            ? { left: 8, top: 0 }
            : config.legendPosition === "top-right"
              ? { right: 8, top: 0 }
              : { left: "center", bottom: 0 }),
          itemWidth: CHART_LEGEND_ITEM.width,
          itemHeight: CHART_LEGEND_ITEM.height,
          textStyle: { fontSize: CHART_FONT_SIZE, color: CHART_INK },
        }
      : { show: false },
    xAxis:
      result.xAxis === "category"
        ? { type: "category", data: result.categories, name: xName, nameGap: 34, ...axisCommon }
        : { type: result.xAxis, name: xName, nameGap: 34, ...axisCommon },
    yAxis: {
      type: "value",
      name: yName,
      nameGap: 52,
      ...(yMin !== null ? { min: yMin } : {}),
      ...(yMax !== null ? { max: yMax } : {}),
      ...axisCommon,
    },
    series: result.series.map((s, i) => ({
      name: s.name,
      type: seriesType,
      data: s.points,
      connectNulls: false,
      ...(config.chartType === "line" ? { symbolSize: 7, lineStyle: { width: 2 } } : {}),
      ...(config.chartType === "scatter" ? { symbolSize: 10 } : {}),
      ...(isHistogram
        ? { barCategoryGap: "0%", itemStyle: { borderColor: "#ffffff", borderWidth: 1 } }
        : {}),
      color: CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length],
    })),
  };
}

function ChartCanvas({
  result,
  config,
}: {
  result: Extract<ChartDataResult, { kind: "ok" }>;
  config: ChartBlockConfig;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartElRef = useRef<HTMLDivElement>(null);
  // ECharts インスタンスは ref でなく state で持つ。ref 代入は再レンダーを
  // 起こさないため、「ready フラグだけ true でインスタンスは null」の瞬間に
  // 描画 effect が走ると、以後 deps が変わらず永久に描画されない事故になる
  // （BlockNote 配下でマウントが交錯すると実際に起きた）。state なら
  // インスタンス確定と同時に描画 effect が必ず再実行される。
  const [chart, setChart] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);

  // コンテナ幅に追従（アスペクト比で高さを決めるため幅を測る）
  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    // cleanup は「この effect 実行が作ったインスタンス」だけを破棄する
    let created: any = null;
    loadECharts()
      .then((ec) => {
        if (disposed || !chartElRef.current) return;
        created = ec.init(chartElRef.current, undefined, { renderer: "svg" });
        setChart(created);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      created?.dispose();
      created = null;
    };
  }, []);

  const height = width > 0 ? Math.round(width / CHART_ASPECT_RATIOS[config.aspect]) : 320;

  useEffect(() => {
    if (!chart) return;
    chart.setOption(buildOption(result, config), true);
    chart.resize();
  }, [chart, result, config, width, height]);

  if (failed) {
    return <div style={styles.emptyState}>{t("chart.noData")}</div>;
  }
  return (
    // 学術図は本文幅を超えて育てない: eureco の実寸（~716px）に合わせて
    // 最大幅 720px・中央寄せ。狭い場所（SidePeek 等）では幅なりに縮む
    <div ref={wrapperRef} style={{ position: "relative", width: "100%", maxWidth: 720, margin: "0 auto" }}>
      {!chart && <div style={styles.loading}>{t("chart.loading")}</div>}
      <div ref={chartElRef} style={{ width: "100%", height }} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    padding: "8px 4px",
  },
  settingsAnchor: {
    position: "absolute",
    top: 8,
    right: 4,
    zIndex: 20,
  },
  settingsButton: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "3px 10px",
    fontSize: 12,
    borderRadius: 8,
    border: "1px solid var(--color-border-subtle)",
    background: "var(--color-surface)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    boxShadow: "var(--shadow-1)",
  },
  caption: {
    textAlign: "center",
    fontSize: 13,
    color: CHART_INK,
    padding: "2px 24px 0",
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
