// チャートブロック
//
// ノート内のテーブル（記録テーブル含む）や、素材にあるデータ（区切りテキスト）を
// 参照して ECharts で描画する。
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
// - 素材のデータは `asset:<fileId>` で参照する（asset-source.ts）。ノートに表を
//   置かずに、過去の測定や文献パターンを別のノートの図に重ねるための道。読み方
//   （見出し行・区切り）は config.assetSources に持ち、表にしたときと同じ列が出る
// - ECharts は初描画時に dynamic import（echarts-loader.ts）。SVG レンダラ
// - 参照切れ（テーブル削除・列名変更・素材の削除）はエラーにせず、その系列だけ空にする

import { createReactBlockSpec } from "@blocknote/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { ChartSpline, Database, SlidersHorizontal } from "lucide-react";
// BlockNote の render は React ツリー外でも呼ばれ得るため Context 不要の t を使う
import { getLocale, t, useLocaleSubscription } from "../../i18n";
import {
  applyStack,
  buildChartData,
  parseDateTime,
  parseNumeric,
  readTableData,
  rowExtentInRange,
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
  PANEL_LABEL_INSET,
  CHART_LINE_WIDTHS,
  CHART_SERIES_COLORS,
  CHART_SYMBOL_SIZES,
  CHART_TICK_LENGTH,
} from "./chart-theme";
import {
  assetSourceKey,
  assetSourceLabel,
  isAssetSourceKey,
  axisOwnerPanel,
  isPanelStackActive,
  panelAxis,
  panelCount,
  parseChartBlockConfig,
  pruneAssetSources,
  resolveSeriesStyle,
  retargetSeries,
  serializeChartBlockConfig,
  seriesConfigDisplayLabel,
  seriesPanelIndex,
  stackConfigForPanel,
  stackSeriesDisplayLabel,
  suggestSeries,
  type ChartAssetSource,
  type ChartBlockConfig,
  type ChartSeriesConfig,
  type ChartSourceOption,
  type DisplayLabel,
  type SeriesType,
} from "./chart-config";
import { computePanelLayout, estimateLegendRows, LEGEND_LINE_HEIGHT } from "./chart-layout";
import { loadAssetTable, primeAssetText, tableFromAssetText } from "./asset-source";
import {
  hasRichMarkup,
  isRich,
  plainOf,
  richStyleDefs,
  stripRichMarkup,
  textOf,
  toEchartsRichText,
} from "./rich-label";
import { peekDataTableFromBlock, subscribeDataTableData } from "../data-table/data";
import { linkedColumnsFor, mergeLinkedColumns } from "../data-table/linked";
import {
  canPickChartAssetSource,
  requestChartAssetSource,
  type ChartAssetSourceResult,
} from "./callbacks";
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
): ChartSourceOption[] {
  const result: ChartSourceOption[] = [];
  const displayNames = computeTableDisplayNames(
    editor?.document ?? [],
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
          kind: "table",
        });
      } else if (b?.type === "dataTable") {
        // データ表（素材を参照する表）。表示名は本文の表と同じ規則（auto-name）で付く
        const label = displayNames.get(b.id) ?? "";
        result.push({
          id: b.id,
          label: label.length > 48 ? `${label.slice(0, 48)}…` : label || t("chart.table"),
          kind: "table",
        });
      }
      if (Array.isArray(b?.children)) visit(b.children);
    }
  };
  visit(editor?.document ?? []);
  return result;
}

/**
 * 素材ソースを表に解決する。
 *
 * ノート内テーブルと違って読み込みは非同期なので、「読み込み中」「読めなかった」を
 * 区別して持つ。読み方（options）が同じ間は読み直さず、素材が増減したときだけ差分で
 * 読む。本文自体は asset-source.ts のキャッシュにあるので、読み方だけ変わっても
 * ネットワークには出ない。
 */
function useAssetTables(sources: ChartAssetSource[]) {
  const loadedRef = useRef(new Map<string, { sig: string; table: TableData | null }>());
  const pendingRef = useRef(new Set<string>());
  const [version, bump] = useReducer((v: number) => v + 1, 0);
  // 素材の集合と読み方が変わったときだけ effect を回す（配列の同一性には頼らない）
  const signature = useMemo(
    () => JSON.stringify(sources.map((s) => [s.fileId, s.options])),
    [sources]
  );

  useEffect(() => {
    let disposed = false;
    const wanted = new Map(
      sources.map((s) => [assetSourceKey(s.fileId), { sig: JSON.stringify(s.options), source: s }])
    );
    for (const key of [...loadedRef.current.keys()]) {
      if (!wanted.has(key)) loadedRef.current.delete(key);
    }
    const pending = new Set<string>();
    for (const [key, { sig, source }] of wanted) {
      const have = loadedRef.current.get(key);
      if (have && have.sig === sig) continue;
      pending.add(key);
      loadAssetTable(source).then(
        (table) => {
          if (disposed) return;
          loadedRef.current.set(key, { sig, table });
          pendingRef.current.delete(key);
          bump();
        },
        () => {
          if (disposed) return;
          // 素材が消えた・実体を読めない: 参照切れとして描く（系列は空になる）
          loadedRef.current.set(key, { sig, table: null });
          pendingRef.current.delete(key);
          bump();
        }
      );
    }
    pendingRef.current = pending;
    bump();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const resolve = useCallback(
    (key: string): TableData | null => loadedRef.current.get(key)?.table ?? null,
    // 読み込みが進むたびに identity を変え、useMemo で抱えている呼び出し側を再計算させる
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );
  const statusOf = useCallback(
    (key: string): ChartSourceOption["status"] => {
      if (pendingRef.current.has(key)) return "pending";
      const have = loadedRef.current.get(key);
      return have && have.table === null ? "missing" : undefined;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version]
  );
  /** 取り込みダイアログで読んだ結果をそのまま載せる（描画のために読み直さない） */
  const prime = useCallback((source: ChartAssetSource, table: TableData) => {
    loadedRef.current.set(assetSourceKey(source.fileId), {
      sig: JSON.stringify(source.options),
      table,
    });
    pendingRef.current.delete(assetSourceKey(source.fileId));
  }, []);
  return { resolve, statusOf, prime, version };
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
    // データ表の素材は非同期に届く（本文は変わらない）ので、到着でも読み直す
    const unsubData = subscribeDataTableData(() => setDocVersion((v) => v + 1));
    return () => {
      if (timer.id) window.clearTimeout(timer.id);
      if (typeof unsub === "function") unsub();
      unsubData();
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
  const assetTables = useAssetTables(config.assetSources);
  // 系列が選べる参照先: ノート内テーブル（文書順）+ このチャートが参照している素材
  const tables = useMemo<ChartSourceOption[]>(
    () => [
      ...collectTables(editor, tableMetaStore),
      ...config.assetSources.map((a) => {
        const id = assetSourceKey(a.fileId);
        return { id, label: assetSourceLabel(a), kind: "asset" as const, status: assetTables.statusOf(id) };
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, docVersion, tableMetaStore?.metas, config.assetSources, assetTables.statusOf]
  );

  // 系列が参照するテーブルを解決する（docVersion で追従）。素材は読み込み済みの表を返す
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolveTable = useMemo(() => {
    const cache = new Map<string, TableData | null>();
    return (key: string): TableData | null => {
      if (isAssetSourceKey(key)) return assetTables.resolve(key);
      if (!cache.has(key)) {
        const block = (editor as any).getBlock?.(key);
        // データ表は calc の計算列も含めて読む（表示と同じ列が描ける）
        const dataTable = mergeLinkedColumns(
          peekDataTableFromBlock(block),
          linkedColumnsFor(key, tableMetaStore?.calcWritebacks),
        );
        cache.set(key, readTableData(block) ?? dataTable?.data ?? null);
      }
      return cache.get(key) ?? null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docVersion, assetTables.resolve, tableMetaStore?.calcWritebacks]);

  const updateConfig = (patch: Partial<ChartBlockConfig>) => {
    (editor as any).updateBlock(block, {
      props: {
        ...block.props,
        // どの系列も指さなくなった素材は落とす（描いていない素材を来歴に残さない）
        config: serializeChartBlockConfig(pruneAssetSources({ ...config, ...patch })),
      },
    });
  };

  const startWithTable = (id: string) => {
    const data = resolveTable(id);
    if (!data) return;
    updateConfig({ series: suggestSeries(data, id) });
  };

  // 素材から系列を足せるか（ホストがピッカー経路を登録しているエディタだけ）
  const canPickAsset = editable && canPickChartAssetSource(editor);

  /**
   * 素材のデータを参照先にする。
   * target が null なら新しい系列を足し（列は表から提案）、番号なら
   * その系列の参照先を素材へ付け替える（列名が合えばそのまま、無ければ提案）。
   */
  const pickAssetSource = (target: number | null) => {
    // 設定パネルはブロックの上に z を持ち上げて描くので、ホストのモーダルより手前に
    // 出てしまう。ピッカーの間は畳み、確定したら開き直す（足した系列が見える）
    const reopenSettings = showSettings;
    setShowSettings(false);
    requestChartAssetSource(editor, (result: ChartAssetSourceResult) => {
      if (reopenSettings) setShowSettings(true);
      const source: ChartAssetSource = {
        fileId: result.fileId,
        fileName: result.fileName,
        options: result.options,
      };
      const key = assetSourceKey(result.fileId);
      const table = tableFromAssetText(result.text, result.options);
      // 読んだ本文と表をそのまま載せる（描画のために素材を読み直さない）
      primeAssetText(result.fileId, result.text);
      assetTables.prime(source, table);
      const assetSources = config.assetSources.some((a) => a.fileId === source.fileId)
        ? config.assetSources.map((a) => (a.fileId === source.fileId ? source : a))
        : [...config.assetSources, source];
      let series: ChartSeriesConfig[];
      if (target === null || !config.series[target]) {
        series = [...config.series, ...suggestSeries(table, key)];
      } else {
        series = config.series.map((s, i) => (i === target ? retargetSeries(s, key, table) : s));
      }
      updateConfig({ assetSources, series });
    });
  };

  // 参照先の候補としてテーブル名の隣に並べる。文言は系列行の「参照先」select の
  // 項目と同じ（参照先を選ぶ場所が違っても、同じ選択肢に同じ名前が出る）
  const assetButton = canPickAsset && (
    <button
      type="button"
      style={styles.assetButton}
      onClick={() => pickAssetSource(null)}
      data-test="chart-pick-asset"
    >
      <Database size={12} strokeWidth={2} />
      {t("chart.pickAssetOption")}
    </button>
  );

  // ── 未設定: テーブル選択プレースホルダ ──
  if (config.series.length === 0) {
    return (
      <div data-test="chart-block" contentEditable={false} style={styles.placeholderShell}>
        <div style={styles.placeholderTitle}>
          <ChartSpline size={15} strokeWidth={2} />
          {t("chart.selectSource")}
        </div>
        {tables.length === 0 && (
          <div style={styles.placeholderEmpty}>
            {canPickAsset ? t("chart.noTablesYet") : t("chart.noTables")}
          </div>
        )}
        {(tables.length > 0 || canPickAsset) && (
          <div style={styles.tableList}>
            {tables.map(({ id, label }) => (
              <button key={id} type="button" style={styles.tableButton} onClick={() => startWithTable(id)} disabled={!editable}>
                {label}
              </button>
            ))}
            {assetButton}
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

  // 素材を読んでいる最中は「参照切れ」と区別する（読めるまでは何も描けないだけ）
  const assetsPending = config.series.some(
    (s) => isAssetSourceKey(s.sourceBlockId) && assetTables.statusOf(s.sourceBlockId) === "pending"
  );

  // ── 全系列が参照切れ ──
  if (specs.every((s) => s.table === null) && !assetsPending) {
    // 消えたのが素材だけなら、テーブルの話をしない
    const onlyAssets = config.series.every((s) => isAssetSourceKey(s.sourceBlockId));
    return (
      <div data-test="chart-block" contentEditable={false} style={styles.placeholderShell}>
        <div style={styles.placeholderTitle}>
          <ChartSpline size={15} strokeWidth={2} />
          {onlyAssets ? t("chart.assetGone") : t("chart.sourceGone")}
        </div>
        {editable && (
          <div style={styles.tableList}>
            {tables
              .filter((tb) => tb.status !== "missing")
              .map(({ id, label }) => (
                <button key={id} type="button" style={styles.tableButton} onClick={() => startWithTable(id)}>
                  {label}
                </button>
              ))}
            {assetButton}
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
              onPickAsset={canPickAsset ? pickAssetSource : undefined}
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
          {/* 素材を読んでいる最中は「データが無い」ではなく読み込み中と出す */}
          {assetsPending
            ? t("chart.loading")
            : result.kind === "empty"
              ? t("chart.noData")
              : t("chart.noNumericSeries")}
        </div>
      )}
      {config.caption.trim() !== "" && <div style={styles.caption}>{config.caption}</div>}
    </div>
  );
}

/**
 * 凡例の文字幅の実測。ECharts に描かせる前に何行になるかを知りたいので、
 * 同じフォント設定の canvas で測る。canvas が使えない環境（テストの jsdom）では
 * 0 を返して、呼び先の近似に任せる
 */
let legendMeasureCtx: CanvasRenderingContext2D | null | undefined;
function measureLegendText(text: string, font: string): number {
  if (legendMeasureCtx === undefined) {
    legendMeasureCtx =
      typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  }
  if (!legendMeasureCtx) return 0;
  legendMeasureCtx.font = font;
  return legendMeasureCtx.measureText(text).width;
}

/**
 * ECharts の option を組み立てる（eureco の学術スタイル、chart-theme.ts の実測値）。
 * 描画状態を持たない純粋な変換。
 * プロット背景は敷かない（eureco 同様）。塗ると系列より前に描かれて点を隠すし、
 * ノートの紙色から図だけ浮く。
 */
export function buildOption(
  result: Extract<ChartDataResult, { kind: "ok" }>,
  config: ChartBlockConfig,
  tables: ChartSourceOption[] = [],
  /** チャート要素の実寸。枠を分割するときだけ要る（grid を px で置くため） */
  size?: { width: number; height: number }
): any {
  const isHistogram = config.chartType === "histogram";
  const count = panelCount(config);
  // 枠を分割していない図は従来どおり 1 枚の grid（外周からの余白指定）で描く。
  // 分割時だけ grid を配列にして px で置く — ECharts の grid は px か % しか
  // 取れないので、割り付けには要素の実寸が要る
  const split = count > 1;
  const locale = getLocale();

  const fontFamily =
    typeof window !== "undefined" ? getComputedStyle(document.body).fontFamily : "sans-serif";

  // 段の名前は「別の列」ではなく「別の試料・別の文献」なので、既定はテーブル名
  const tableLabelOf = (blockId: string) => tables.find((tb) => tb.id === blockId)?.label;

  // 図に出す名前は「人が書いたもの」と「データから拾ったもの」で扱いが違う。
  // 前者だけが LaTeX 記法（\it{斜体} / ^{上付き} / _{下付き}）の対象で、後者
  //（列名・テーブル名）は生データの識別子なので字のまま出す。
  const derived = (text: string): DisplayLabel => ({ text, authored: false });
  const authored = (text: string): DisplayLabel => ({ text, authored: true });

  // X 軸の min/max。時間軸は日時文字列、数値軸は数値として読む（カテゴリ軸は対象外）
  const parseX = result.xAxis === "time" ? parseDateTime : parseNumeric;
  const parseXBound = (raw: string) => (result.xAxis !== "category" ? parseX(raw) : null);
  // 軸の名前と範囲は枠ごと。つなげた向きは端の枠が持ち主なので、同じ値に解決される
  const axisOf = (panelIndex: number) => {
    const x = panelAxis(config, axisOwnerPanel(config.panels, panelIndex, "x"));
    const y = panelAxis(config, axisOwnerPanel(config.panels, panelIndex, "y"));
    return {
      xAxisName: x.xAxisName,
      xMin: parseXBound(x.xMin),
      xMax: parseXBound(x.xMax),
      yAxisName: y.yAxisName,
      yMin: parseNumeric(y.yMin),
      yMax: parseNumeric(y.yMax),
      yRightAxisName: y.yRightAxisName,
      yRightMin: parseNumeric(y.yRightMin),
      yRightMax: parseNumeric(y.yRightMax),
    };
  };

  // 折れ線・散布図の値軸はデータ範囲にフィットさせる（scale: true = 0 を含む強制を
  // 外す）。気圧 ~1000 hPa のような系列が 0 起点で上に張り付くのを防ぐ。
  // 棒・ヒストグラムは長さが量を表すので 0 基準のまま
  const fitAxis = config.chartType === "line" || config.chartType === "scatter";

  // ── 枠ごとの中身を先に組む ──────────────────────────────────────
  // 軸の範囲を枠をまたいで揃える（つなげたとき）ので、描画は 2 周目に回す
  type PanelBuild = {
    /** この枠に属する系列の、config.series での添字 */
    indices: number[];
    /** 規格化・段オフセットを済ませた、この枠ぶんのデータ */
    view: Extract<ChartDataResult, { kind: "ok" }>;
    stack: ReturnType<typeof stackConfigForPanel>;
    stackActive: boolean;
    useRight: boolean;
    /** 軸名。記法を解釈してよいのは人が書いたものだけなので、出どころごと持つ */
    xLabel: DisplayLabel;
    yLabel: DisplayLabel;
    yRightLabel: DisplayLabel;
    /** 記法を落とした素の軸名。余白の計算と、枠をまたいだ一致判定に使う */
    xName: string;
    yName: string;
    yRightName: string;
    /** オフセット表示の縦範囲（段の実データから決める） */
    stackRange: { min: number; max: number } | null;
    /** この枠のデータが占める X の範囲（つなげたときの共有範囲の計算に使う） */
    xExtent: { min: number; max: number } | null;
    /** 明示された名前・範囲（つなげた向きは持ち主の枠のもの） */
    axis: ReturnType<typeof axisOf>;
  };

  const panels: PanelBuild[] = [];
  for (let p = 0; p < count; p++) {
    const indices = config.series.map((_, i) => i).filter((i) => seriesPanelIndex(config.series[i], count) === p);
    const panelSeries = indices.map((i) => config.series[i]);
    const sub: Extract<ChartDataResult, { kind: "ok" }> = {
      ...result,
      series: indices.map((i) => result.series[i]).filter(Boolean),
    };
    const stack = stackConfigForPanel(config, p);
    // オフセット表示は枠ごとに独立して効く（片方の枠だけ積む、が成り立つ）
    const stackActive = isPanelStackActive(config, p, result.xAxis, panelSeries.length);
    // スタック中は段の縦位置がすべての意味を持つので、第 2 軸は併用させない
    const useRight = !isHistogram && !stackActive && panelSeries.some((s) => s?.axis === "right");

    // 描画に使う値は規格化 + 段オフセット後のもの。元の値は各系列に残る
    // offset / scale から復元してツールチップに出す
    const view = stackActive
      ? applyStack(sub, {
          normalize: stack.normalize,
          gap: stack.gap,
          order: stack.order,
          perSeries: panelSeries.map((s) => ({ scale: s?.scale, offsetAdjust: s?.offsetAdjust })),
        })
      : sub;

    // X 軸名の自動値: histogram は対象列、それ以外は枠の中で共通の X 列名
    const axis = axisOf(p);
    const xColumns = [...new Set(panelSeries.map((s) => (isHistogram ? s?.yColumn : s?.xColumn)))];
    const xLabel: DisplayLabel = axis.xAxisName.trim()
      ? authored(axis.xAxisName.trim())
      : derived(xColumns.length === 1 ? (xColumns[0] ?? "") : "");

    const leftSeries = panelSeries.filter((s) => s?.axis !== "right");
    const rightSeries = panelSeries.filter((s) => s?.axis === "right");
    // スタック中は縦軸が a.u.（段の高さに絶対的な意味がない）ので、
    // 系列名を軸名に流用しない。名前を出すならユーザーが明示する。
    // 枠を分けた図では軸名も枠ごとに決まる（σ・S・PF・κ を並べるとき、
    // 明示していなければ各枠が自分の系列名を名乗る）
    const yLabel: DisplayLabel = axis.yAxisName.trim()
      ? authored(axis.yAxisName.trim())
      : stackActive
        ? derived("")
        : isHistogram
          ? derived(t("chart.frequency"))
          : leftSeries.length === 1 && leftSeries[0]
            ? // 系列の表示名を軸名に流用するときは、その名前の出どころごと引き継ぐ
              seriesConfigDisplayLabel(leftSeries[0])
            : derived("");
    const yRightLabel: DisplayLabel = axis.yRightAxisName.trim()
      ? authored(axis.yRightAxisName.trim())
      : rightSeries.length === 1 && rightSeries[0]
        ? seriesConfigDisplayLabel(rightSeries[0])
        : derived("");

    // スタック時の縦範囲。段の実データから決める（規格化後の値を ECharts の
    // 自動計算に任せると、キリのいい目盛りに丸められて上下に余白が出る）。
    // 上側は最上段のピークが枠にくっつかないぶんを広く取る
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
      // 下は最下段が枠線に貼り付かない程度
      return { min: lo - span * 0.05, max: hi + span * 0.1 };
    })();

    const xExtent = (() => {
      if (result.xAxis === "category") return null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const s of view.series) {
        for (const [x] of s.points as Array<[number, number]>) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
      }
      return Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : null;
    })();

    panels.push({
      indices,
      view,
      stack,
      stackActive,
      useRight,
      xLabel,
      yLabel,
      yRightLabel,
      xName: xLabel.text,
      yName: yLabel.text,
      yRightName: yRightLabel.text,
      stackRange,
      xExtent,
      axis,
    });
  }

  // 全枠の縦軸名が同じなら、枠ごとに出さず図の左に 1 つだけ置く（N×1 に同じ
  // "Intensity" が縦に並ぶのを避ける）。判定は文字列の一致という離散な条件なので、
  // なぜ 1 つになったのかをユーザーが説明できる。設定は増やさない
  const sharedYName =
    panels.length > 1 && panels[0].yName !== "" && panels.every((p) => p.yName === panels[0].yName)
      ? panels[0].yName
      : null;

  const anyStackActive = panels.some((p) => p.stackActive);
  const anyInlineStackLabels = panels.some((p) => p.stackActive && p.stack.labels === "inline");

  // 凡例に並ぶ名前。プロット領域の余白を決める前に要る（凡例が何行になるかで
  // 上端・下端が動くため）。段オフセット中はテーブル名を名乗るので枠ごとに解決する
  const seriesLabelOf = (panelIndex: number, i: number): DisplayLabel => {
    const sc = config.series[i];
    if (!sc) return derived("");
    return panels[panelIndex]?.stackActive
      ? stackSeriesDisplayLabel(sc, tableLabelOf(sc.sourceBlockId))
      : seriesConfigDisplayLabel(sc);
  };
  // 系列の内部名。ツールチップと書き出しに出るので、記法は落として渡す
  const seriesNameOf = (panelIndex: number, i: number): string => plainOf(seriesLabelOf(panelIndex, i));
  const legendNames = panels.flatMap((panel, p) => panel.indices.map((i) => seriesNameOf(p, i)));
  // 凡例は系列名（＝記法を落とした素のテキスト）で引かれるので、記法を書いた
  // 系列だけ、そこから描画用の rich text に戻せるようにしておく
  const legendRichText = new Map<string, string>();
  panels.forEach((panel, p) => {
    for (const i of panel.indices) {
      const label = seriesLabelOf(p, i);
      if (label.authored && hasRichMarkup(label.text)) {
        legendRichText.set(stripRichMarkup(label.text), toEchartsRichText(label.text));
      }
    }
  });
  const legendHasRich = legendRichText.size > 0;

  // ── レイアウト ──────────────────────────────────────────────────
  // 段ラベルを図に直接置くときは、凡例は同じ情報の二重表示になるので出さない
  const showLegend = config.showLegend && !anyInlineStackLabels;
  const legendTop =
    showLegend &&
    (config.legendPosition === "top-left" || config.legendPosition === "top-right");
  const legendBottom = showLegend && config.legendPosition === "bottom";
  // プロット領域の余白。凡例の座標計算にも同じ値を使う。
  // 分割時は「どれかの枠が名前を持つか」で外周を決める（枠ごとに余白を変えると
  // 枠の大きさが揃わず、図が読み比べにならない）
  const anyYName = sharedYName !== null || panels.some((p) => p.yName !== "");
  const anyXName = panels.some((p) => p.xName !== "");
  const anyUseRight = panels.some((p) => p.useRight);
  const anyYRightName = panels.some((p) => p.yRightName !== "");
  const gridLeft = anyYName ? 84 : 60;
  const gridRight = anyUseRight ? (anyYRightName ? 84 : 60) : 32;
  // 凡例は折り返すと 2 行目以降がプロット枠に重なるので、行数ぶんの高さを先に空ける。
  // 1 行に収まるときは従来と同じ値（48 / 32）になるので既存の図は動かない。
  // 凡例の幅は右上の設定ボタンに掛からないところまでに絞り、見積もりと実際の
  // 折り返し位置を合わせる
  const chartWidth = size?.width && size.width > 0 ? size.width : 0;
  const legendWidth = chartWidth > 0 ? Math.max(0, chartWidth - gridLeft - Math.max(gridRight, 72)) : 0;
  const legendRows =
    showLegend && (legendTop || legendBottom)
      ? estimateLegendRows(legendNames, legendWidth, config.legendOrient, CHART_FONT_SIZE, (text) =>
          measureLegendText(text, `${CHART_FONT_SIZE}px ${fontFamily}`)
        )
      : 1;
  const extraLegendRows = Math.max(0, legendRows - 1) * LEGEND_LINE_HEIGHT;
  const gridTop = legendTop ? 48 + extraLegendRows : 20;
  const gridBottom = (anyXName ? 64 : 40) + (legendBottom ? 32 + extraLegendRows : 0);

  // 縦につないだ列だけが X を共有する。横のつなぎ（Y の共有）は x とは関係ない
  const crossPanelTooltip =
    split && config.panels.joinVertical && config.panels.rows > 1 && result.xAxis !== "category";

  const layout = split
    ? computePanelLayout({
        rows: config.panels.rows,
        cols: config.panels.cols,
        // 実寸が来ていない初回描画では本文幅なりの値で置く（測れた時点で組み直される）
        width: size?.width && size.width > 0 ? size.width : 720,
        height: size?.height && size.height > 0 ? size.height : 320,
        outer: { left: gridLeft, right: gridRight, top: gridTop, bottom: gridBottom },
        xAxisSpace: anyXName ? 64 : 40,
        yAxisSpace: gridLeft,
        joinVertical: config.panels.joinVertical,
        joinHorizontal: config.panels.joinHorizontal,
      })
    : null;

  // つなげた向きは軸を共有する = 範囲も実際に揃える。揃えないと目盛りだけ
  // 最下段（左端）に出るのに枠ごとの縮尺が違う、という嘘の図になる
  const sharedXExtent = (col: number) => {
    if (!split || !config.panels.joinVertical) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (let row = 0; row < config.panels.rows; row++) {
      const e = panels[row * config.panels.cols + col]?.xExtent;
      if (!e) continue;
      if (e.min < lo) lo = e.min;
      if (e.max > hi) hi = e.max;
    }
    return Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : null;
  };

  // 軸の詳細設定（表示トグル・ラベル回転・目盛りの向き・グリッド）を ECharts に写す
  // axisLabel を渡すと、人が書いた軸名なら LaTeX 記法を ECharts の rich text に
  // 変換して name に載せる。記法が無ければ rich を足さないので、従来のノートの
  // 図はまったく同じ option で描かれる
  const axisFromDetail = (detail: typeof config.xAxisDetail, axisLabel?: DisplayLabel) => ({
    ...(axisLabel === undefined ? {} : { name: textOf(axisLabel) }),
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
    nameTextStyle: {
      fontSize: CHART_FONT_SIZE,
      color: CHART_INK,
      ...(axisLabel !== undefined && isRich(axisLabel)
        ? { rich: richStyleDefs(CHART_FONT_SIZE) }
        : {}),
    },
    z: 3,
  });

  // つなげた向きの内側の枠は、目盛りラベルと軸名を落とす（軸そのものは残すので
  // 枠線と目盛りの刻みは出る）。これをやらないと上の枠のラベルが下の枠の天井に貼り付く
  const hideAxisText = (axis: any) => ({
    ...axis,
    name: "",
    axisLabel: { ...(axis.axisLabel ?? {}), show: false },
  });

  // 継ぎ目のラベルを 1 つ落とす。枠を接して置くと、上の枠の最小値のラベルと
  // 下の枠の最大値のラベルが同じ高さに来て重なる（"500" と "1.3" が "501.3" に見える）。
  // 消すのは内側の枠の側 = 下の枠の最大値・右の枠の最小値
  const trimEdgeLabel = (axis: any, key: "showMaxLabel" | "showMinLabel") => ({
    ...axis,
    axisLabel: { ...(axis.axisLabel ?? {}), [key]: false },
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

  // ── 枠ごとに軸と系列を組む ──────────────────────────────────────
  // 系列の option。オフセット表示中の棒は土台の系列を挟むので、view.series と
  // option の series は 1 対 1 にならない。ツールチップが元の値へ戻せるよう、
  // option と同じ並びの元データ（土台は null）を tooltipSeries に持つ
  const optionSeries: any[] = [];
  const tooltipSeries: Array<ChartSeriesData | null> = [];
  const xAxes: any[] = [];
  const yAxes: any[] = [];
  // 枠をまたいで 1 つのツールチップに出すための一覧。
  // まとめてよいのは X を共有している枠 = 縦につないだ同じ列の枠だけ。
  // つないでいない枠は別の図なので、同じ x に並べて見せると嘘になる
  const crossPanelRows: Array<{
    column: number;
    name: string;
    color: string;
    points: Array<[number, number]>;
    source: ChartSeriesData;
  }> = [];
  // 本文を出す係（各列の最上段の枠に属する系列）の、option 上の添字 → 列
  const reporterColumnOf = new Map<number, number>();

  panels.forEach((panel, p) => {
    const col = split ? p % config.panels.cols : 0;
    const row = split ? Math.floor(p / config.panels.cols) : 0;
    const showX = layout ? layout.showXAxis[p] : true;
    const showY = layout ? layout.showYAxis[p] : true;
    const shared = sharedXExtent(col);
    const { xMin, xMax, yMin, yMax, yRightMin, yRightMax } = panel.axis;
    // 枠の Y 軸は yAxes の何番目か（第 2 軸を持つ枠があるので枠番号とは一致しない）
    const yAxisBase = yAxes.length;

    // 段名を段のどの隅に置くか（凡例と同じ選び方で四隅から選ぶ）
    const inlineLabelAtLeft = panel.stack.labelPosition.endsWith("left");
    const inlineLabelAtTop = panel.stack.labelPosition.startsWith("top");
    // 段名を出す横位置。プロット枠の内側にそろえる（論文図の作法）。段ごとの
    // データの終わりに置くと、段によって名前の位置がずれて図の中に散らばる
    const inlineLabelX = (() => {
      if (!panel.stackActive || panel.stack.labels !== "inline") return null;
      const fixed = inlineLabelAtLeft ? xMin : xMax;
      if (fixed !== null) return fixed;
      let edge = inlineLabelAtLeft ? Infinity : -Infinity;
      for (const s of panel.view.series) {
        for (const [x] of s.points as Array<[number, number]>) {
          if (inlineLabelAtLeft ? x < edge : x > edge) edge = x;
        }
      }
      return Number.isFinite(edge) ? edge : null;
    })();

    const leftAxis = {
      type: "value" as const,
      // 共有した縦軸名は図の左に 1 つだけ置くので、枠の軸は名乗らない
      name: sharedYName !== null ? "" : panel.yName,
      nameGap: 52,
      scale: fitAxis,
      ...(yMin !== null ? { min: yMin } : {}),
      ...(yMax !== null ? { max: yMax } : {}),
      ...axisFromDetail(config.yAxisDetail),
      // 段の高さは a.u.（規格化とオフセットで元の尺度を失う）なので目盛りを出さない。
      // 範囲はユーザーが明示していればそちらを優先する
      ...(panel.stackActive
        ? {
            axisTick: { show: false },
            axisLabel: { show: false },
            splitLine: { show: false },
            ...(panel.stackRange && yMin === null ? { min: panel.stackRange.min } : {}),
            ...(panel.stackRange && yMax === null ? { max: panel.stackRange.max } : {}),
          }
        : {}),
      ...(split ? { gridIndex: p } : {}),
    };
    const rightAxis = {
      type: "value" as const,
      name: panel.yRightName,
      nameGap: 52,
      scale: fitAxis,
      ...(yRightMin !== null ? { min: yRightMin } : {}),
      ...(yRightMax !== null ? { max: yRightMax } : {}),
      ...axisFromDetail(config.yRightAxisDetail),
      ...(split ? { gridIndex: p } : {}),
    };
    // 軸名を載せるので、X 軸の詳細はこの枠ぶんを作る
    const xAxisDetail = axisFromDetail(config.xAxisDetail, panel.xLabel);
    const trimmedLeftAxis =
      split && config.panels.joinVertical && row > 0
        ? trimEdgeLabel(leftAxis, "showMaxLabel")
        : leftAxis;
    yAxes.push(showY ? trimmedLeftAxis : hideAxisText(trimmedLeftAxis));
    if (panel.useRight) yAxes.push(rightAxis);

    const xAxis =
      result.xAxis === "category"
        ? { type: "category", data: result.categories, name: panel.xName, nameGap: 34, ...xAxisDetail }
        : {
            type: result.xAxis,
            name: panel.xName,
            nameGap: 34,
            // 数値 X 軸はデータ範囲にフィットさせる。既定（0 を含む）だと気圧
            // 998〜1015 hPa や 2θ = 10〜60° のような系列が右側に潰れる。
            // 縦軸と違って棒でも 0 基準にする理由はない（棒の長さは縦方向の量）ので
            // 種類によらず常にフィットさせる。時間軸は既定でデータ範囲に収まるので
            // 対象外（scale は value 軸のみ有効）
            ...(result.xAxis === "value" ? { scale: true } : {}),
            // min/max を明示していればそちらが優先される（ECharts の既定挙動）
            ...(xMin !== null ? { min: xMin } : shared ? { min: shared.min } : {}),
            ...(xMax !== null ? { max: xMax } : shared ? { max: shared.max } : {}),
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
          };
    const trimmedXAxis =
      split && config.panels.joinHorizontal && col > 0
        ? trimEdgeLabel(xAxis, "showMinLabel")
        : xAxis;
    xAxes.push(
      showX
        ? { ...trimmedXAxis, ...(split ? { gridIndex: p } : {}) }
        : { ...hideAxisText(trimmedXAxis), ...(split ? { gridIndex: p } : {}) }
    );


    panel.view.series.forEach((s, k) => {
      const i = panel.indices[k];
      const sc = config.series[i];
      const seriesType: SeriesType = isHistogram
        ? "bar"
        : ((sc?.type ?? config.chartType) as SeriesType);
      // 色は枠をまたいで通し番号で振る（同じ色が別の枠に出ると別物と読めない）
      const color = sc?.color || CHART_SERIES_COLORS[i % CHART_SERIES_COLORS.length];
      const name = seriesNameOf(p, i);
      const points = s.points as Array<[number, number]>;
      // 段の名前は枠の左右どちらかの端に寄せ、縦はその段が占める範囲の内側に収める。
      // 範囲内に 1 点も無い段は図に何も描かれないので名前も出さない
      const rowExtent = inlineLabelX !== null ? rowExtentInRange(points, xMin, xMax) : null;
      const inlineLabel = rowExtent !== null;
      // 系列ごとの見た目（線種・線幅・マーカー・棒幅・積み上げ）。未設定は
      // 従来の描画と同じ値に解決されるので、既存ノートの図は変わらない
      const baseStyle = resolveSeriesStyle(sc, seriesType);
      // オフセット表示中だけ既定をマーカー無し・細線・小さめの点に寄せる。スペクトルは
      // 連続曲線として読むもので、数千点にマーカーを打つと線が潰れるため。
      // 明示的に設定されているものはそのまま尊重する
      const style = panel.stackActive
        ? {
            ...baseStyle,
            showSymbol: sc?.showSymbol ?? false,
            lineWidth: sc?.lineWidth ?? ("thin" as const),
            symbolSize: sc?.symbolSize ?? ("small" as const),
          }
        : baseStyle;
      // 棒は必ず 0 から立ち上がる（ECharts は系列ごとの起点を持てない）ため、
      // 段オフセットを値に足しただけだと最下段以外の棒が枠の下端まで伸びてしまう。
      // 段の高さぶんの透明な棒を土台として敷き、その上に実データを積んで起点をずらす
      const stackBase = panel.stackActive && seriesType === "bar" ? (s.offset ?? 0) : 0;
      const stackedData =
        stackBase !== 0
          ? points.map(([x, y]) => [x, y - stackBase] as [number, number])
          : s.points;
      const baseGroup = `stack-base-${i}`;
      // 枠ごとに軸の番号が違うので、系列にも割り当て先を書く
      const axisIndex = split
        ? { xAxisIndex: p, yAxisIndex: yAxisBase + (panel.useRight && sc?.axis === "right" ? 1 : 0) }
        : panel.useRight
          ? { yAxisIndex: sc?.axis === "right" ? 1 : 0 }
          : {};
      if (stackBase !== 0) {
        optionSeries.push({
          name: `__${baseGroup}`,
          type: "bar",
          stack: baseGroup,
          silent: true,
          data: points.map(([x]) => [x, stackBase] as [number, number]),
          itemStyle: { opacity: 0 },
          ...axisIndex,
          ...(style.barWidth !== "auto" ? { barWidth: CHART_BAR_WIDTHS[style.barWidth] } : {}),
        });
        // ツールチップでは土台の行を出さない
        tooltipSeries.push(null);
      }
      optionSeries.push({
        name,
        type: seriesType,
        data: stackedData,
        connectNulls: false,
        ...axisIndex,
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
              // 段の土台を敷いた棒はそのグループに積む（スペクトル比較が優先。
              // 系列どうしの積み上げは段の中で意味を持たない）。
              // 通常の積み上げは軸ごとにグループを分ける（左右をまたぐと目盛りと合わない）
              ...(stackBase !== 0
                ? { stack: baseGroup }
                : style.stacked
                  ? { stack: `${p}-${sc?.axis === "right" ? "right" : "left"}` }
                  : {}),
            }
          : {}),
        ...(isHistogram
          ? { barCategoryGap: "0%", itemStyle: { borderColor: "#ffffff", borderWidth: 1 } }
          : {}),
        // 段の名前は段の四隅のどこかに置く。凡例より段との対応が一目で分かる。
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
                  formatter: () => textOf(seriesLabelOf(p, i)),
                  ...(isRich(seriesLabelOf(p, i)) ? { rich: richStyleDefs(CHART_FONT_SIZE) } : {}),
                  // 枠の内側へ入れ、縦は段の内側へ落とし込む（上端の下・下端の上）
                  position: inlineLabelAtLeft ? "right" : "left",
                  offset: [inlineLabelAtLeft ? 4 : -4, inlineLabelAtTop ? 12 : -12],
                  fontSize: CHART_FONT_SIZE,
                  color,
                },
                // 横は全段で同じ（枠の左右どちらかの端）、縦はその段の上端／下端
                data: [{ coord: [inlineLabelX, inlineLabelAtTop ? rowExtent.max : rowExtent.min] }],
              },
            }
          : {}),
        color,
      });
      // 土台を敷いた系列は描画値から段オフセットを抜いてあるので、戻す量も 0
      if (crossPanelTooltip) {
        if (row === 0) reporterColumnOf.set(optionSeries.length - 1, col);
        crossPanelRows.push({ column: col, name, color, points, source: s });
      }
      tooltipSeries.push(stackBase !== 0 ? { ...s, offset: 0 } : s);
    });
  });

  // パネル記号 (a)(b)(c)(d)。枠の左上の内側に置く。外に出すと、つなげたときに
  // 上の枠へ食い込む（枠の間に余白が無い）
  const panelLabelAtLeft = config.panels.labelPosition.endsWith("left");
  const panelLabelAtTop = config.panels.labelPosition.startsWith("top");
  const panelTitles =
    layout && config.panels.showPanelLabels
      ? layout.grids.map((g, i) => ({
          text: `(${String.fromCharCode(97 + (i % 26))})`,
          left: panelLabelAtLeft
            ? g.left + PANEL_LABEL_INSET.left
            : g.left + g.width - PANEL_LABEL_INSET.right,
          top: panelLabelAtTop
            ? g.top + PANEL_LABEL_INSET.top
            : g.top + g.height - PANEL_LABEL_INSET.bottom,
          // left / top をどの角として扱うかは title の textAlign / textVerticalAlign。
          // textStyle の align は「題の中での行揃え」で、置く位置は動かない
          //（右下に指定しても文字が left/top から右下へ伸び、枠からはみ出す）
          textAlign: panelLabelAtLeft ? ("left" as const) : ("right" as const),
          textVerticalAlign: panelLabelAtTop ? ("top" as const) : ("bottom" as const),
          textStyle: {
            fontSize: CHART_FONT_SIZE,
            fontWeight: "bold" as const,
            color: CHART_INK,
          },
          z: 11,
        }))
      : [];

  // 共有した縦軸名。枠をまたぐので軸には載せられず、図全体の座標に回転テキストで置く。
  // 縦位置は全枠の上端〜下端の中央
  const sharedYNameGraphic = (() => {
    if (sharedYName === null || !layout) return [];
    const top = Math.min(...layout.grids.map((g) => g.top));
    const bottom = Math.max(...layout.grids.map((g) => g.top + g.height));
    return [
      {
        type: "text" as const,
        left: 18,
        top: (top + bottom) / 2,
        rotation: Math.PI / 2,
        style: {
          text: sharedYName,
          fontSize: CHART_FONT_SIZE,
          fill: CHART_INK,
          align: "center" as const,
          verticalAlign: "middle" as const,
        },
        z: 11,
        silent: true,
      },
    ];
  })();

  const frame = {
    show: config.showFrame,
    borderColor: CHART_FRAME,
    borderWidth: CHART_FRAME_WIDTH,
    z: 10,
  };

  return {
    animation: false,
    textStyle: { fontFamily, fontSize: CHART_FONT_SIZE, color: CHART_INK },
    // 記号も共有縦軸名も分割時だけのものなので、1×1 の option には現れない
    ...(panelTitles.length > 0 ? { title: panelTitles } : {}),
    ...(sharedYNameGraphic.length > 0 ? { graphic: sharedYNameGraphic } : {}),
    grid: layout
      ? layout.grids.map((g) => ({ ...frame, ...g }))
      : {
          ...frame,
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
      // つないだ枠は同じ x を見ているので、ECharts は枠の数だけツールチップを開く。
      // 先頭の枠のぶんだけが本文を出し、そこに全枠の値をまとめて並べる
      ...(crossPanelTooltip && crossPanelRows.length > 0
        ? {
            formatter: crossPanelTooltipFormatter(
              locale,
              result.xAxis,
              crossPanelRows,
              reporterColumnOf
            ),
          }
        : anyStackActive
          ? { formatter: stackTooltipFormatter(locale, result.xAxis, tooltipSeries) }
          : result.xAxis === "time"
            ? { formatter: timeTooltipFormatter(locale) }
            : {}),
    },
    legend: showLegend
      ? {
          show: true,
          // 土台の系列（オフセット表示の棒）は凡例に出さない
          data: legendNames,
          orient: config.legendOrient,
          // 実寸が分かっているときだけ幅を絞る（見積もりと同じ位置で折り返させ、
          // 右上の設定ボタンに潜り込ませない）
          ...(legendWidth > 0 && config.legendOrient === "horizontal" ? { width: legendWidth } : {}),
          ...legendLayout,
          itemWidth: CHART_LEGEND_ITEM.width,
          itemHeight: CHART_LEGEND_ITEM.height,
          textStyle: {
            fontSize: CHART_FONT_SIZE,
            color: CHART_INK,
            ...(legendHasRich ? { rich: richStyleDefs(CHART_FONT_SIZE) } : {}),
          },
          // 凡例は系列名（記法を落とした素のテキスト）で引かれる。記法を書いた
          // 系列だけ、描画用の rich text に戻す
          ...(legendHasRich
            ? { formatter: (name: string) => legendRichText.get(name) ?? name }
            : {}),
          z: 12,
        }
      : { show: false },
    // 十字カーソルは列の中だけで連動させる。列をまたいで連動させると、
    // 別の X を持つ隣の列にも同じ位置の線が出て、合っていない値を指す
    ...(crossPanelTooltip
      ? {
          axisPointer: {
            link: Array.from({ length: config.panels.cols }, (_, c) => ({
              xAxisIndex: Array.from({ length: config.panels.rows }, (_, r) => r * config.panels.cols + c),
            })),
          },
        }
      : {}),
    xAxis: split ? xAxes : xAxes[0],
    yAxis: split ? yAxes : panels[0]?.useRight ? yAxes : yAxes[0],
    series: optionSeries,
  };
}

/**
 * スタック時のツールチップ。
 *
 * 描画上の y は規格化 + 段オフセット後の値なので、そのまま出すと
 * 「2 段目の 1.45」のような読めない数字になる。各系列に残した
 * offset / scale から元の測定値へ戻して出す。
 */
/**
 * 枠をまたいだツールチップ。
 *
 * 枠をつなぐと十字カーソルが全枠を貫くが、ECharts のツールチップは grid ごとに
 * 開くので、そのままだと同じ x の箱が枠の数だけ重なる。先頭の枠のぶんだけを
 * 本文つきにし（他は空文字を返して消す）、そこに全枠の値を並べる。
 * 「同じ 2θ で各段がいくつか」を 1 か所で読める形にするのが、枠を分けて
 * 並べる目的そのものなので、値を集めるのはこの形が素直。
 */
function crossPanelTooltipFormatter(
  locale: ReturnType<typeof getLocale>,
  xKind: XAxisKind,
  rows: Array<{
    column: number;
    name: string;
    color: string;
    points: Array<[number, number]>;
    source: ChartSeriesData;
  }>,
  reporterColumnOf: Map<number, number>
) {
  // その x に最も近い点の値。段ごとに測定間隔が違っても隣の点を拾えるようにする
  const valueAt = (points: Array<[number, number]>, x: number): number | null => {
    let best: number | null = null;
    let bestGap = Infinity;
    for (const [px, py] of points) {
      const gap = Math.abs(px - x);
      if (gap < bestGap) {
        bestGap = gap;
        best = py;
      }
    }
    return best;
  };
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    // 本文を出すのは、その列の最上段の枠に属する係だけ。
    // 下の段のぶんは空文字を返して箱ごと消す（同じ内容が段の数だけ開くため）
    const reporter = list.find((p: any) => reporterColumnOf.has(p.seriesIndex));
    if (!reporter) return "";
    const column = reporterColumnOf.get(reporter.seriesIndex)!;
    const first = list[0];
    const x = Number(Array.isArray(first.value) ? first.value[0] : first.axisValue);
    const head = xKind === "time" ? formatFullDateTime(x, locale) : String(first.axisValue ?? x);
    const body = rows.filter((row) => row.column === column).map((row) => {
      const drawn = valueAt(row.points, x);
      if (drawn === null) return "";
      const raw = unstackValue(drawn, row.source);
      const marker = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${row.color};margin-right:4px"></span>`;
      return `${marker}${row.name}: ${Number.isFinite(raw) ? raw : ""}`;
    });
    return [head, ...body.filter(Boolean)].join("<br/>");
  };
}

function stackTooltipFormatter(
  locale: ReturnType<typeof getLocale>,
  xKind: XAxisKind,
  series: Array<ChartSeriesData | null>
) {
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    const first = list[0];
    const x = Array.isArray(first.value) ? first.value[0] : first.axisValue;
    const head = xKind === "time" ? formatFullDateTime(Number(x), locale) : String(x);
    // 段の土台は値を持たない飾りなので行にしない
    const rows = list
      .filter((p: any) => series[p.seriesIndex])
      .map((p: any) => {
      const drawn = Number(Array.isArray(p.value) ? p.value[1] : p.value);
      const raw = unstackValue(drawn, series[p.seriesIndex] ?? undefined);
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
  tables?: ChartSourceOption[];
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
    chart.setOption(buildOption(result, config, tables, { width, height }), true);
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
  // 素材から選ぶ入口。テーブルの候補ボタンと同じ見た目で、先頭にアイコンを添える
  //（svg は block 扱いになる環境があるので inline-flex で横に並べる）
  assetButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
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
