// チャートブロック
//
// ノート内のテーブル（記録テーブル含む）を参照して ECharts で描画する。
// eureco に合わせて系列（series）が第一級: 各系列が「どのテーブルの・どの列を
// X/Y にするか」を持ち、複数テーブルを 1 つのチャートに重ねられる。
// 見た目は学術スタイル（詳細は chart-theme.ts 冒頭）、設定はタブ式パネル
//（思考順序: 何を見るか → スケール → 体裁）。
//
// 設計メモ:
// - データはあくまでテーブル側が真実。チャートは設定 JSON（参照 blockId +
//   列名 + 描き方）だけを持ち、テーブル編集には editor.onChange 経由で追従する
// - テーブルは blockId・列は列名で参照する（並べ替え・行の追加に強い。
//   表示名「表 N」は毎回計算する自動名なので、番号が変わっても参照は壊れない）
// - ECharts は初描画時に dynamic import（echarts-loader.ts）。SVG レンダラ
// - 参照切れ（テーブル削除・列名変更）はエラーにせず、その系列だけ空にする

import { createReactBlockSpec } from "@blocknote/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChartSpline, SlidersHorizontal } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { getLocale, t, useLocaleSubscription } from "../../i18n";
import {
  applyStack,
  buildChartData,
  parseDateTime,
  parseNumeric,
  readTableData,
  unstackValue,
  type ChartDataResult,
  type ChartSeriesData,
  type TableData,
  type XAxisKind,
} from "./chart-data";
import { loadECharts } from "./echarts-loader";
import {
  CHART_ASPECT_RATIOS,
  CHART_AXIS_LINE_WIDTH,
  CHART_BAR_WIDTHS,
  CHART_FONT_SIZE,
  CHART_FRAME,
  CHART_FRAME_WIDTH,
  CHART_GRID_LINE,
  CHART_INK,
  CHART_LEGEND_ITEM,
  CHART_LINE_WIDTHS,
  CHART_SERIES_COLORS,
  CHART_SYMBOL_SIZES,
  CHART_TICK_LENGTH,
} from "./chart-theme";
import {
  isStackActive,
  parseChartBlockConfig,
  resolveSeriesStyle,
  serializeChartBlockConfig,
  seriesConfigDisplayName,
  stackSeriesDisplayName,
  suggestSeries,
  usesRightAxis,
  type ChartBlockConfig,
  type SeriesType,
} from "./chart-config";
import { ChartSettingsPanel } from "./chart-settings";
import { formatFullDateTime, timeAxisLabelFormatter } from "./time-axis-format";
// 記録テーブルの名前（キャプション）を参照表示に使う。Provider が無い場所でも
// 動くよう optional 版で読む
import { useTableMetaStoreOptional } from "../../features/table-meta/store";
import { computeTableDisplayNames } from "../../features/table-meta/auto-name";

/**
 * ノート内の table ブロックを（文書順で）集める。
 * 名前（キャプション）が付いていればそれを、日時が入る列を持つテーブルは無名でも
 * 文書順の自動名（表 N）を、どちらも無ければヘッダ行の連結を表示する（eureco の
 * 「データテーブル1: 地点Aの観測結果」に相当する、参照に耐える名前を出すため）。
 */
function collectTables(
  editor: any,
  tableMeta?: {
    hasColumnType: (blockId: string, type: "datetime-auto" | "note-link") => boolean;
    getCaption: (blockId: string) => string;
  } | null
): Array<{ id: string; label: string }> {
  const result: Array<{ id: string; label: string }> = [];
  const displayNames = computeTableDisplayNames(
    editor?.document ?? [],
    (blockId) => tableMeta?.hasColumnType(blockId, "datetime-auto") ?? false,
    (blockId) => tableMeta?.getCaption(blockId) ?? ""
  );
  const visit = (blocks: any[]) => {
    for (const b of blocks ?? []) {
      if (b?.type === "table") {
        let label = displayNames.get(b.id) ?? "";
        if (!label) {
          const data = readTableData(b);
          label = (data?.headers ?? []).filter(Boolean).join(" | ");
        }
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
      /** 旧形式（チャート全体で 1 テーブル参照）の互換用。新規には使わない */
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
  // 言語切替でラベルを引き直す（BlockNote の render は Context を辿れないため購読する）
  useLocaleSubscription();
  const editable = (editor as any).isEditable !== false;
  const config = useMemo(
    () =>
      parseChartBlockConfig(
        String(block.props.config ?? ""),
        String(block.props.sourceBlockId ?? "")
      ),
    [block.props.config, block.props.sourceBlockId]
  );

  const [showSettings, setShowSettings] = useState(false);
  // パネルの置き場所: 画面に余白があればチャートの右外（図が隠れない）、
  // 無ければ従来どおり右上に重ねる（すりガラスで下を透かす）
  const [panelPlacement, setPanelPlacement] = useState<"outside" | "overlay">("overlay");
  // 設定ボタン + パネルのアンカー。外側クリック判定はこの要素基準で行う
  // （ブロック全体を基準にするとチャート上のクリックで閉じなくなる）
  const settingsAnchorRef = useRef<HTMLDivElement>(null);

  const computePanelPlacement = () => {
    const rect = settingsAnchorRef.current?.getBoundingClientRect();
    const fits = rect ? rect.right + 308 <= window.innerWidth - 8 : false;
    setPanelPlacement(fits ? "outside" : "overlay");
  };

  // 開いている間はリサイズで置き場所を選び直す
  useEffect(() => {
    if (!showSettings) return;
    window.addEventListener("resize", computePanelPlacement);
    return () => window.removeEventListener("resize", computePanelPlacement);
  }, [showSettings]);

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

  const tableMetaStore = useTableMetaStoreOptional();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(
    () => collectTables(editor, tableMetaStore),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docVersion, tableMetaStore?.metas]
  );

  // 系列が参照するテーブルを解決する（docVersion で追従）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolveTable = useMemo(() => {
    const cache = new Map<string, TableData | null>();
    return (blockId: string): TableData | null => {
      if (!cache.has(blockId)) {
        cache.set(blockId, readTableData((editor as any).getBlock?.(blockId)));
      }
      return cache.get(blockId) ?? null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docVersion]);

  const updateConfig = (patch: Partial<ChartBlockConfig>) => {
    (editor as any).updateBlock(block, {
      props: {
        ...block.props,
        config: serializeChartBlockConfig({ ...config, ...patch }),
      },
    });
  };

  const startWithTable = (id: string) => {
    const data = resolveTable(id);
    if (!data) return;
    updateConfig({ series: suggestSeries(data, id) });
  };

  // ── 未設定: テーブル選択プレースホルダ ──
  if (config.series.length === 0) {
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
              <button key={id} type="button" style={styles.tableButton} onClick={() => startWithTable(id)} disabled={!editable}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const specs = config.series.map((s) => ({
    table: resolveTable(s.sourceBlockId),
    xColumn: s.xColumn,
    yColumn: s.yColumn,
  }));

  // ── 全系列が参照切れ ──
  if (specs.every((s) => s.table === null)) {
    return (
      <div data-test="chart-block" contentEditable={false} style={styles.placeholderShell}>
        <div style={styles.placeholderTitle}>
          <ChartSpline size={15} strokeWidth={2} />
          {t("chart.sourceGone")}
        </div>
        {editable && (
          <div style={styles.tableList}>
            {tables.map(({ id, label }) => (
              <button key={id} type="button" style={styles.tableButton} onClick={() => startWithTable(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const result = buildChartData({
    chartType: config.chartType,
    series: specs,
    ...(config.xAxisKind !== "auto" ? { xAxisKind: config.xAxisKind } : {}),
  });

  return (
    <div data-test="chart-block" contentEditable={false} style={styles.shell}>
      {editable && (
        <div
          ref={settingsAnchorRef}
          // PDF 書き出しはこの属性で設定ボタンごと除去する（印刷物に UI を残さない）
          data-chart-ui="true"
          // パネルを開いている間は z を引き上げる。後続のチャートブロックの
          // 設定ボタン（同 z のスタッキングコンテキスト）が DOM 順でパネルの
          // 上に描かれてしまうのを防ぐ
          style={{ ...styles.settingsAnchor, zIndex: showSettings ? 120 : 20 }}
        >
          <button
            type="button"
            onClick={() => {
              computePanelPlacement();
              setShowSettings((v) => !v);
            }}
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
              resolveTable={resolveTable}
              placement={panelPlacement}
              onClose={() => setShowSettings(false)}
            />
          )}
        </div>
      )}
      {result.kind === "ok" ? (
        <ChartCanvas result={result} config={config} tables={tables} />
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
 * プロット背景は敷かない（eureco 同様）。塗ると系列より前に描かれて点を隠すし、
 * ノートの紙色から図だけ浮く。
 */
function buildOption(
  result: Extract<ChartDataResult, { kind: "ok" }>,
  config: ChartBlockConfig,
  tables: Array<{ id: string; label: string }> = []
): any {
  const isHistogram = config.chartType === "histogram";
  // スタック中は段の縦位置がすべての意味を持つので、第 2 軸は併用させない
  const stackActive = isStackActive(config, result.xAxis);
  const useRight = !isHistogram && !stackActive && usesRightAxis(config);

  // 描画に使う値は規格化 + 段オフセット後のもの。元の値は各系列に残る
  // offset / scale から復元してツールチップに出す
  const view = stackActive
    ? applyStack(result, {
        normalize: config.stack.normalize,
        gap: config.stack.gap,
        order: config.stack.order,
        perSeries: config.series.map((s) => ({ scale: s.scale, offsetAdjust: s.offsetAdjust })),
      })
    : result;

  // 段の名前は「別の列」ではなく「別の試料・別の文献」なので、既定はテーブル名
  const tableLabelOf = (blockId: string) => tables.find((tb) => tb.id === blockId)?.label;
  const seriesName = (i: number): string => {
    const sc = config.series[i];
    if (!sc) return "";
    return stackActive
      ? stackSeriesDisplayName(sc, tableLabelOf(sc.sourceBlockId))
      : seriesConfigDisplayName(sc);
  };

  // X 軸名の自動値: histogram は対象列、それ以外は全系列で共通の X 列名
  const xColumns = [...new Set(config.series.map((s) => (isHistogram ? s.yColumn : s.xColumn)))];
  const xName = config.xAxisName.trim() || (xColumns.length === 1 ? xColumns[0] : "");

  const leftSeries = config.series.filter((s) => s.axis !== "right");
  const rightSeries = config.series.filter((s) => s.axis === "right");
  // スタック中は縦軸が a.u.（段の高さに絶対的な意味がない）ので、
  // 系列名を軸名に流用しない。名前を出すならユーザーが明示する
  const yName =
    config.yAxisName.trim() ||
    (stackActive
      ? ""
      : isHistogram
        ? t("chart.frequency")
        : leftSeries.length === 1
          ? seriesConfigDisplayName(leftSeries[0])
          : "");
  const yRightName =
    config.yRightAxisName.trim() ||
    (rightSeries.length === 1 ? seriesConfigDisplayName(rightSeries[0]) : "");

  // プロット領域の余白。凡例の座標計算にも同じ値を使う
  const gridLeft = yName ? 84 : 60;
  const gridRight = useRight ? (yRightName ? 84 : 60) : 32;
  // 段ラベルを図に直接置くときは、凡例は同じ情報の二重表示になるので出さない
  const showLegend = config.showLegend && !(stackActive && config.stack.labels === "inline");
  const legendTop =
    showLegend &&
    (config.legendPosition === "top-left" || config.legendPosition === "top-right");
  const legendBottom = showLegend && config.legendPosition === "bottom";
  const gridTop = legendTop ? 48 : 20;
  const gridBottom = (xName ? 64 : 40) + (legendBottom ? 32 : 0);

  const fontFamily =
    typeof window !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";

  // 軸の詳細設定（表示トグル・ラベル回転・目盛りの向き・グリッド）を ECharts に写す
  const axisFromDetail = (detail: typeof config.xAxisDetail) => ({
    show: detail.show,
    axisLine: {
      show: detail.showLine,
      lineStyle: { width: CHART_AXIS_LINE_WIDTH, color: CHART_FRAME },
    },
    axisTick: {
      show: detail.showTicks,
      length: CHART_TICK_LENGTH,
      inside: detail.tickInside,
      lineStyle: { color: CHART_FRAME },
    },
    axisLabel: {
      show: detail.showLabels,
      fontSize: CHART_FONT_SIZE,
      color: CHART_INK,
      ...(detail.labelRotate !== null ? { rotate: detail.labelRotate } : {}),
    },
    splitLine: detail.showGrid
      ? { show: true, lineStyle: { ...CHART_GRID_LINE, color: "#cccccc" } }
      : { show: false },
    nameLocation: "middle" as const,
    nameTextStyle: { fontSize: CHART_FONT_SIZE, color: CHART_INK },
    z: 3,
  });

  // 凡例の配置。top-* は枠の左右端に揃え、inside-* は枠内の四隅に置く
  const legendLayout = (() => {
    switch (config.legendPosition) {
      case "top-left":
        return { left: gridLeft, top: 6 };
      case "top-right":
        return { right: gridRight, top: 6 };
      case "bottom":
        return { left: "center" as const, bottom: 0 };
      case "inside-top-left":
        return { left: gridLeft + 12, top: gridTop + 10, ...INSIDE_LEGEND_STYLE };
      case "inside-top-right":
        return { right: gridRight + 12, top: gridTop + 10, ...INSIDE_LEGEND_STYLE };
      case "inside-bottom-left":
        return { left: gridLeft + 12, bottom: gridBottom + 10, ...INSIDE_LEGEND_STYLE };
      case "inside-bottom-right":
        return { right: gridRight + 12, bottom: gridBottom + 10, ...INSIDE_LEGEND_STYLE };
    }
  })();

  const locale = getLocale();
  const xAxisDetail = axisFromDetail(config.xAxisDetail);

  const yMin = parseNumeric(config.yMin);
  const yMax = parseNumeric(config.yMax);
  const yRightMin = parseNumeric(config.yRightMin);
  const yRightMax = parseNumeric(config.yRightMax);
  // X 軸の min/max。時間軸は日時文字列、数値軸は数値として読む（カテゴリ軸は対象外）
  const parseX = result.xAxis === "time" ? parseDateTime : parseNumeric;
  const xMin = result.xAxis !== "category" ? parseX(config.xMin) : null;
  const xMax = result.xAxis !== "category" ? parseX(config.xMax) : null;

  // 折れ線・散布図の値軸はデータ範囲にフィットさせる（scale: true = 0 を含む強制を
  // 外す）。気圧 ~1000 hPa のような系列が 0 起点で上に張り付くのを防ぐ。
  // 棒・ヒストグラムは長さが量を表すので 0 基準のまま
  const fitAxis = config.chartType === "line" || config.chartType === "scatter";

  // スタック時の縦範囲。段の実データから決める（規格化後の値を ECharts の
  // 自動計算に任せると、キリのいい目盛りに丸められて上下に余白が出る）。
  // 上側は段ラベルが載るぶんを広く取る
  const stackRange = (() => {
    if (!stackActive) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of view.series) {
      for (const [, y] of s.points as Array<[number, number]>) {
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const span = hi - lo || 1;
    // 下は最下段が枠線に貼り付かない程度、上は段ラベルが載るぶん
    return { min: lo - span * 0.05, max: hi + span * 0.1 };
  })();

  const leftAxis = {
    type: "value" as const,
    name: yName,
    nameGap: 52,
    scale: fitAxis,
    ...(yMin !== null ? { min: yMin } : {}),
    ...(yMax !== null ? { max: yMax } : {}),
    ...axisFromDetail(config.yAxisDetail),
    // 段の高さは a.u.（規格化とオフセットで元の尺度を失う）なので目盛りを出さない。
    // 範囲はユーザーが明示していればそちらを優先する
    ...(stackActive
      ? {
          axisTick: { show: false },
          axisLabel: { show: false },
          splitLine: { show: false },
          ...(stackRange && yMin === null ? { min: stackRange.min } : {}),
          ...(stackRange && yMax === null ? { max: stackRange.max } : {}),
        }
      : {}),
  };
  const rightAxis = {
    type: "value" as const,
    name: yRightName,
    nameGap: 52,
    scale: fitAxis,
    ...(yRightMin !== null ? { min: yRightMin } : {}),
    ...(yRightMax !== null ? { max: yRightMax } : {}),
    ...axisFromDetail(config.yRightAxisDetail),
  };

  return {
    animation: false,
    textStyle: { fontFamily, fontSize: CHART_FONT_SIZE, color: CHART_INK },
    grid: {
      show: config.showFrame,
      borderColor: CHART_FRAME,
      borderWidth: CHART_FRAME_WIDTH,
      z: 10,
      left: gridLeft,
      right: gridRight,
      top: gridTop,
      bottom: gridBottom,
    },
    tooltip: {
      trigger: config.chartType === "scatter" ? "item" : "axis",
      axisPointer: {
        type: "line",
        lineStyle: { width: 0.8, type: "dashed" },
        z: 2,
      },
      backgroundColor: "#ffffff",
      borderColor: "#cccccc",
      textStyle: { fontSize: 13, color: CHART_INK },
      // 時間軸の値は epoch ms なので、既定のままだと散布図で生の数値が出る。
      // 見出しに完全な日時を出して 1 点を同定できるようにする。
      // スタック中は描画値が規格化済みなので、元の値に戻して出す
      ...(stackActive
        ? { formatter: stackTooltipFormatter(locale, result.xAxis, view.series) }
        : result.xAxis === "time"
          ? { formatter: timeTooltipFormatter(locale) }
          : {}),
    },
    legend: showLegend
      ? {
          show: true,
          orient: config.legendOrient,
          ...legendLayout,
          itemWidth: CHART_LEGEND_ITEM.width,
          itemHeight: CHART_LEGEND_ITEM.height,
          textStyle: { fontSize: CHART_FONT_SIZE, color: CHART_INK },
          z: 12,
        }
      : { show: false },
    xAxis:
      result.xAxis === "category"
        ? { type: "category", data: result.categories, name: xName, nameGap: 34, ...axisFromDetail(config.xAxisDetail) }
        : {
            type: result.xAxis,
            name: xName,
            nameGap: 34,
            // 数値 X 軸はデータ範囲にフィットさせる。既定（0 を含む）だと気圧
            // 998〜1015 hPa や 2θ = 10〜60° のような系列が右側に潰れる。
            // 縦軸と違って棒でも 0 基準にする理由はない（棒の長さは縦方向の量）ので
            // 種類によらず常にフィットさせる。時間軸は既定でデータ範囲に収まるので
            // 対象外（scale は value 軸のみ有効）
            ...(result.xAxis === "value" ? { scale: true } : {}),
            // min/max を明示していればそちらが優先される（ECharts の既定挙動）
            ...(xMin !== null ? { min: xMin } : {}),
            ...(xMax !== null ? { max: xMax } : {}),
            ...xAxisDetail,
            // 時間軸は既定だと日境界が日番号だけ（"14"）になる。月日を出す
            ...(result.xAxis === "time"
              ? {
                  axisLabel: {
                    ...xAxisDetail.axisLabel,
                    formatter: timeAxisLabelFormatter(locale),
                  },
                }
              : {}),
          },
    yAxis: useRight ? [leftAxis, rightAxis] : leftAxis,
    series: view.series.map((s, i) => {
      const sc = config.series[i];
      const seriesType: SeriesType = isHistogram
        ? "bar"
        : ((sc?.type ?? config.chartType) as SeriesType);
      const color = sc?.color || CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
      const name = seriesName(i);
      const points = s.points as Array<[number, number]>;
      const inlineLabel = stackActive && config.stack.labels === "inline" && points.length > 0;
      // 系列ごとの見た目（線種・線幅・マーカー・棒幅・積み上げ）。未設定は
      // 従来の描画と同じ値に解決されるので、既存ノートの図は変わらない
      const baseStyle = resolveSeriesStyle(sc, seriesType);
      // 積み重ね中だけ既定をマーカー無し・細線・小さめの点に寄せる。スペクトルは
      // 連続曲線として読むもので、数千点にマーカーを打つと線が潰れるため。
      // 明示的に設定されているものはそのまま尊重する
      const style = stackActive
        ? {
            ...baseStyle,
            showSymbol: sc?.showSymbol ?? false,
            lineWidth: sc?.lineWidth ?? ("thin" as const),
            symbolSize: sc?.symbolSize ?? ("small" as const),
          }
        : baseStyle;
      return {
        name,
        type: seriesType,
        data: s.points,
        connectNulls: false,
        ...(useRight ? { yAxisIndex: sc?.axis === "right" ? 1 : 0 } : {}),
        ...(seriesType === "line"
          ? {
              showSymbol: style.showSymbol,
              symbol: style.symbol,
              symbolSize: CHART_SYMBOL_SIZES.line[style.symbolSize],
              lineStyle: { width: CHART_LINE_WIDTHS[style.lineWidth], type: style.lineType },
            }
          : {}),
        ...(seriesType === "scatter"
          ? { symbol: style.symbol, symbolSize: CHART_SYMBOL_SIZES.scatter[style.symbolSize] }
          : {}),
        // 分布（ヒストグラム）は階級幅が棒の幅を決める図なので、幅・積み上げは持たせない
        ...(seriesType === "bar" && !isHistogram
          ? {
              ...(style.barWidth !== "auto" ? { barWidth: CHART_BAR_WIDTHS[style.barWidth] } : {}),
              // 積み上げは軸ごとにグループを分ける（左右をまたいで積むと目盛りと合わない）
              ...(style.stacked ? { stack: sc?.axis === "right" ? "right" : "left" } : {}),
            }
          : {}),
        ...(isHistogram
          ? { barCategoryGap: "0%", itemStyle: { borderColor: "#ffffff", borderWidth: 1 } }
          : {}),
        // 段の名前は右端の点の左上に置く。凡例より段との対応が一目で分かる。
        // symbol: "none" にするとラベルごと描かれないので、大きさ 0 の点に付ける
        ...(inlineLabel
          ? {
              markPoint: {
                silent: true,
                animation: false,
                symbol: "circle",
                symbolSize: 0,
                label: {
                  show: true,
                  // 文字列を渡すと {b} 等がテンプレートとして解釈されるため関数で返す
                  formatter: () => name,
                  // 右端の点から左上へ逃がす。パターンの線に被ると読めなくなる
                  position: "left",
                  offset: [-4, -18],
                  fontSize: CHART_FONT_SIZE,
                  color,
                },
                data: [{ coord: points[points.length - 1] }],
              },
            }
          : {}),
        color,
      };
    }),
  };
}

/**
 * スタック時のツールチップ。
 *
 * 描画上の y は規格化 + 段オフセット後の値なので、そのまま出すと
 * 「2 段目の 1.45」のような読めない数字になる。各系列に残した
 * offset / scale から元の測定値へ戻して出す。
 */
function stackTooltipFormatter(
  locale: ReturnType<typeof getLocale>,
  xKind: XAxisKind,
  series: ChartSeriesData[]
) {
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    const first = list[0];
    const x = Array.isArray(first.value) ? first.value[0] : first.axisValue;
    const head = xKind === "time" ? formatFullDateTime(Number(x), locale) : String(x);
    const rows = list.map((p: any) => {
      const drawn = Number(Array.isArray(p.value) ? p.value[1] : p.value);
      const raw = unstackValue(drawn, series[p.seriesIndex]);
      return `${p.marker ?? ""}${p.seriesName ?? ""}: ${Number.isFinite(raw) ? raw : ""}`;
    });
    return [head, ...rows].join("<br/>");
  };
}

/** 時間軸のツールチップ: 見出しに完全な日時、各行に系列名と値 */
function timeTooltipFormatter(locale: ReturnType<typeof getLocale>) {
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    const first = list[0];
    const x = Array.isArray(first.value) ? first.value[0] : first.axisValue;
    const head = formatFullDateTime(Number(x), locale);
    const rows = list.map((p: any) => {
      const y = Array.isArray(p.value) ? p.value[1] : p.value;
      return `${p.marker ?? ""}${p.seriesName ?? ""}: ${y ?? ""}`;
    });
    return [head, ...rows].join("<br/>");
  };
}

// 枠内に置く凡例は、データ点と重なっても読めるよう薄い白地を敷く
const INSIDE_LEGEND_STYLE = {
  backgroundColor: "rgba(255,255,255,0.75)",
  padding: 6,
  borderRadius: 3,
};

function ChartCanvas({
  result,
  config,
  tables,
}: {
  result: Extract<ChartDataResult, { kind: "ok" }>;
  config: ChartBlockConfig;
  /** スタック時の段名をテーブル名から解決するために渡す */
  tables?: Array<{ id: string; label: string }>;
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
    chart.setOption(buildOption(result, config, tables), true);
    chart.resize();
  }, [chart, result, config, tables, width, height]);

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
    fontSize: 14,
    color: CHART_INK,
    padding: "6px 24px 0",
    maxWidth: 720,
    margin: "0 auto",
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
