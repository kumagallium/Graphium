// chart-config.ts（設定 JSON のパース・デフォルト埋め・旧形式マイグレーション）のテスト

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHART_CONFIG,
  parseChartBlockConfig,
  resolveSeriesStyle,
  serializeChartBlockConfig,
  seriesConfigDisplayName,
  suggestSeries,
  usesRightAxis,
  isStackActive,
  stackSeriesDisplayName,
  DEFAULT_STACK_CONFIG,
  STACK_GAP_RANGE,
  assetSourceKey,
  isAssetSourceKey,
  assetFileIdFromKey,
  assetSourceLabel,
  pruneAssetSources,
  collectChartAssetFileIds,
  type ChartSeriesConfig,
} from "./chart-config";
import type { TableData } from "./chart-data";

describe("parseChartBlockConfig", () => {
  it("空文字・壊れた JSON はデフォルトに落ちる", () => {
    expect(parseChartBlockConfig("")).toEqual(DEFAULT_CHART_CONFIG);
    expect(parseChartBlockConfig("{broken")).toEqual(DEFAULT_CHART_CONFIG);
    expect(parseChartBlockConfig("null")).toEqual(DEFAULT_CHART_CONFIG);
  });

  it("欠けたフィールドはデフォルトで埋まる（後方互換）", () => {
    const parsed = parseChartBlockConfig(JSON.stringify({ chartType: "bar" }));
    expect(parsed.chartType).toBe("bar");
    expect(parsed.series).toEqual([]);
    expect(parsed.aspect).toBe("standard");
    expect(parsed.showLegend).toBe(true);
    expect(parsed.showFrame).toBe(true);
    expect(parsed.xAxisDetail.showGrid).toBe(false);
    expect(parsed.yAxisDetail.showGrid).toBe(false);
    expect(parsed.xAxisDetail.tickInside).toBe(true);
  });

  it("旧グリッドフラグ（showGrid / showGridX / showGridY）は軸詳細に引き継がれる", () => {
    const both = parseChartBlockConfig(JSON.stringify({ showGrid: true }));
    expect(both.xAxisDetail.showGrid).toBe(true);
    expect(both.yAxisDetail.showGrid).toBe(true);
    const onlyY = parseChartBlockConfig(JSON.stringify({ showGridY: true }));
    expect(onlyY.xAxisDetail.showGrid).toBe(false);
    expect(onlyY.yAxisDetail.showGrid).toBe(true);
  });

  it("軸詳細は部分マージで読める（欠けはデフォルト）", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({ xAxisDetail: { showLabels: false, labelRotate: 45, tickInside: false } })
    );
    expect(parsed.xAxisDetail).toEqual({
      show: true,
      showLine: true,
      showTicks: true,
      showLabels: false,
      labelRotate: 45,
      tickInside: false,
      showGrid: false,
    });
  });

  it("旧形式（1 テーブル + yColumns + seriesOptions）は系列モデルに移行される", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        chartType: "line",
        xColumn: "日時",
        yColumns: ["痛み", "気圧"],
        seriesOptions: { 気圧: { axis: "right", color: "#2563EB" }, 痛み: { label: "頭痛" } },
      }),
      "table-1"
    );
    expect(parsed.series).toEqual([
      { sourceBlockId: "table-1", xColumn: "日時", yColumn: "痛み", label: "頭痛" },
      { sourceBlockId: "table-1", xColumn: "日時", yColumn: "気圧", axis: "right", color: "#2563EB" },
    ]);
  });

  it("旧形式の histogram は対象列が yColumn に移る", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({ chartType: "histogram", xColumn: "痛み" }),
      "table-1"
    );
    expect(parsed.series).toEqual([
      { sourceBlockId: "table-1", xColumn: "", yColumn: "痛み" },
    ]);
  });

  it("series の不正エントリは落とす", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        series: [
          { sourceBlockId: "t1", xColumn: "日時", yColumn: "痛み", type: "bar" },
          { sourceBlockId: "t1" }, // yColumn 欠け
          "junk",
          { sourceBlockId: "t1", xColumn: "日時", yColumn: "気圧", type: "pie" }, // 不正 type
        ],
      })
    );
    expect(parsed.series).toEqual([
      { sourceBlockId: "t1", xColumn: "日時", yColumn: "痛み", type: "bar" },
      { sourceBlockId: "t1", xColumn: "日時", yColumn: "気圧" },
    ]);
  });

  it("系列スタイルの不正値は落として既定に戻す", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        series: [
          {
            sourceBlockId: "t1",
            xColumn: "日時",
            yColumn: "痛み",
            lineType: "dotted",
            lineWidth: "thin",
            showSymbol: false,
            symbol: "emptyRect",
            symbolSize: "small",
            barWidth: "wide",
            stacked: true,
          },
          {
            sourceBlockId: "t1",
            xColumn: "日時",
            yColumn: "気圧",
            lineType: "wavy",
            lineWidth: "hairline",
            showSymbol: "yes",
            symbol: "star",
            symbolSize: "huge",
            barWidth: "fat",
            stacked: 1,
          },
        ],
      })
    );
    expect(parsed.series[0]).toEqual({
      sourceBlockId: "t1",
      xColumn: "日時",
      yColumn: "痛み",
      lineType: "dotted",
      lineWidth: "thin",
      showSymbol: false,
      symbol: "emptyRect",
      symbolSize: "small",
      barWidth: "wide",
      stacked: true,
    });
    expect(parsed.series[1]).toEqual({ sourceBlockId: "t1", xColumn: "日時", yColumn: "気圧" });
  });

  it("serialize → parse で往復できる", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      chartType: "scatter" as const,
      series: [
        { sourceBlockId: "t1", xColumn: "気圧", yColumn: "痛み", label: "頭痛", color: "#DC2626" },
        { sourceBlockId: "t2", xColumn: "日時", yColumn: "睡眠", axis: "right" as const, type: "line" as const },
      ],
      caption: "気圧と頭痛強度",
      xAxisKind: "value" as const,
      xMin: "990",
      xMax: "1020",
      yMin: "0",
      yMax: "10",
      aspect: "spectrum" as const,
      xAxisDetail: {
        ...DEFAULT_CHART_CONFIG.xAxisDetail,
        showGrid: true,
        labelRotate: 45,
        tickInside: false,
      },
      yAxisDetail: { ...DEFAULT_CHART_CONFIG.yAxisDetail, showLabels: false },
      legendPosition: "inside-top-right" as const,
      legendOrient: "vertical" as const,
      yRightAxisName: "睡眠時間",
    };
    expect(parseChartBlockConfig(serializeChartBlockConfig(config))).toEqual(config);
  });
});

describe("suggestSeries / helpers", () => {
  const diary: TableData = {
    headers: ["日時", "痛み", "気圧", "メモ"],
    rows: [
      ["2026-08-09 07:30", "6", "1008", "寝不足"],
      ["2026-08-10 21:00", "3", "1013", ""],
    ],
  };

  it("X = 最初の列、系列 = それ以外の数値列", () => {
    expect(suggestSeries(diary, "t1")).toEqual([
      { sourceBlockId: "t1", xColumn: "日時", yColumn: "痛み" },
      { sourceBlockId: "t1", xColumn: "日時", yColumn: "気圧" },
    ]);
  });

  it("スタイル未設定は従来の描画と同じ値に解決される", () => {
    const series: ChartSeriesConfig = { sourceBlockId: "t1", xColumn: "日時", yColumn: "痛み" };
    expect(resolveSeriesStyle(series, "line")).toEqual({
      lineType: "solid",
      lineWidth: "medium",
      showSymbol: true,
      // ECharts の既定に合わせる（折れ線は白抜き円・散布図は塗り円）
      symbol: "emptyCircle",
      symbolSize: "medium",
      barWidth: "auto",
      stacked: false,
    });
    expect(resolveSeriesStyle(series, "scatter").symbol).toBe("circle");
    expect(resolveSeriesStyle(undefined, "bar").barWidth).toBe("auto");
  });

  it("設定したスタイルは種類の既定より優先される", () => {
    const series: ChartSeriesConfig = {
      sourceBlockId: "t1",
      xColumn: "日時",
      yColumn: "痛み",
      lineType: "dashed",
      lineWidth: "thick",
      showSymbol: false,
      symbol: "triangle",
      symbolSize: "large",
      barWidth: "narrow",
      stacked: true,
    };
    expect(resolveSeriesStyle(series, "line")).toEqual({
      lineType: "dashed",
      lineWidth: "thick",
      showSymbol: false,
      symbol: "triangle",
      symbolSize: "large",
      barWidth: "narrow",
      stacked: true,
    });
  });

  it("seriesConfigDisplayName / usesRightAxis", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      series: [
        { sourceBlockId: "t1", xColumn: "日時", yColumn: "痛み", label: "頭痛" },
        { sourceBlockId: "t1", xColumn: "日時", yColumn: "気圧", axis: "right" as const },
      ],
    };
    expect(seriesConfigDisplayName(config.series[0])).toBe("頭痛");
    expect(seriesConfigDisplayName(config.series[1])).toBe("気圧");
    expect(usesRightAxis(config)).toBe(true);
    expect(usesRightAxis(DEFAULT_CHART_CONFIG)).toBe(false);
  });
});

describe("スタック表示の設定", () => {
  it("旧ノート（stack を持たない）は既定の無効状態で読める", () => {
    const parsed = parseChartBlockConfig(JSON.stringify({ chartType: "line" }));
    expect(parsed.stack).toEqual(DEFAULT_STACK_CONFIG);
    expect(parsed.stack.enabled).toBe(false);
  });

  it("部分指定は残りが既定で埋まる", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({ stack: { enabled: true, order: "first-top" } })
    );
    expect(parsed.stack.enabled).toBe(true);
    expect(parsed.stack.order).toBe("first-top");
    expect(parsed.stack.normalize).toBe("max");
    expect(parsed.stack.labels).toBe("inline");
  });

  it("段間隔は範囲内に丸める（負の値で段が反転しない）", () => {
    expect(parseChartBlockConfig(JSON.stringify({ stack: { gap: -3 } })).stack.gap).toBe(
      STACK_GAP_RANGE.min
    );
    expect(parseChartBlockConfig(JSON.stringify({ stack: { gap: 99 } })).stack.gap).toBe(
      STACK_GAP_RANGE.max
    );
    expect(parseChartBlockConfig(JSON.stringify({ stack: { gap: "広め" } })).stack.gap).toBe(
      DEFAULT_STACK_CONFIG.gap
    );
  });

  it("系列の倍率は 0 以下を読み捨てる（系列が消えるのを防ぐ）", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        series: [
          { sourceBlockId: "t1", xColumn: "2θ", yColumn: "強度", scale: 5, offsetAdjust: -0.2 },
          { sourceBlockId: "t1", xColumn: "2θ", yColumn: "強度", scale: 0 },
        ],
      })
    );
    expect(parsed.series[0].scale).toBe(5);
    expect(parsed.series[0].offsetAdjust).toBe(-0.2);
    expect(parsed.series[1].scale).toBeUndefined();
  });

  it("往復（serialize → parse）で内容が変わらない", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      stack: {
        enabled: true,
        normalize: "none" as const,
        gap: 0.8,
        order: "first-top" as const,
        labels: "legend" as const,
        labelPosition: "bottom-left" as const,
      },
    };
    expect(parseChartBlockConfig(serializeChartBlockConfig(config))).toEqual(config);
  });
});

describe("isStackActive", () => {
  const withStack = (patch: object = {}) => ({
    ...DEFAULT_CHART_CONFIG,
    series: [{ sourceBlockId: "t1", xColumn: "2θ", yColumn: "強度" }],
    stack: { ...DEFAULT_STACK_CONFIG, enabled: true },
    ...patch,
  });

  it("有効かつ数値軸なら効く", () => {
    expect(isStackActive(withStack(), "value")).toBe(true);
    expect(isStackActive(withStack(), "time")).toBe(true);
  });

  it("無効・系列なし・分布・カテゴリ軸では効かない", () => {
    expect(isStackActive(DEFAULT_CHART_CONFIG, "value")).toBe(false);
    expect(isStackActive(withStack({ series: [] }), "value")).toBe(false);
    expect(isStackActive(withStack({ chartType: "histogram" }), "value")).toBe(false);
    expect(isStackActive(withStack(), "category")).toBe(false);
  });
});

describe("stackSeriesDisplayName", () => {
  const series = { sourceBlockId: "t1", xColumn: "2θ", yColumn: "強度" };

  it("既定はテーブル名（XRD だと全段の Y 列名が同じで区別できないため）", () => {
    expect(stackSeriesDisplayName(series, "試料 A の測定")).toBe("試料 A の測定");
  });

  it("表示名を明示すればそちらが勝つ", () => {
    expect(stackSeriesDisplayName({ ...series, label: "文献 B" }, "試料 A の測定")).toBe("文献 B");
  });

  it("テーブル名が無ければ列名に落ちる", () => {
    expect(stackSeriesDisplayName(series, undefined)).toBe("強度");
    expect(stackSeriesDisplayName(series, "  ")).toBe("強度");
  });
});

describe("素材ソース（assetSources / asset: キー）", () => {
  const options = { headerRow: 3, endRow: 120, delimiter: "tab" as const, collapseConsecutive: false };

  it("キーの往復: fileId → asset:<fileId> → fileId", () => {
    expect(assetSourceKey("f1")).toBe("asset:f1");
    expect(isAssetSourceKey("asset:f1")).toBe(true);
    expect(isAssetSourceKey("asset:")).toBe(false);
    expect(isAssetSourceKey("block-1")).toBe(false);
    expect(assetFileIdFromKey("asset:f1")).toBe("f1");
    expect(assetFileIdFromKey("block-1")).toBeNull();
  });

  it("表示名は拡張子を落とした素材名（取り込んだ表の既定キャプションと同じ規則）", () => {
    expect(assetSourceLabel({ fileName: "sample-A_XRD.txt" })).toBe("sample-A_XRD");
    expect(assetSourceLabel({ fileName: "noext" })).toBe("noext");
  });

  it("assetSources は読み方ごと往復し、旧ノート（未指定）は空で読める", () => {
    expect(parseChartBlockConfig("{}").assetSources).toEqual([]);
    const config = {
      ...DEFAULT_CHART_CONFIG,
      series: [{ sourceBlockId: "asset:f1", xColumn: "2theta", yColumn: "I" }],
      assetSources: [{ fileId: "f1", fileName: "ref.dat", options: { ...options, delimiter: "custom" as const, customDelimiter: ";" } }],
    };
    expect(parseChartBlockConfig(serializeChartBlockConfig(config)).assetSources).toEqual(config.assetSources);
  });

  it("読み方が欠けた・壊れた素材ソースは落とし、同じ fileId は先勝ち", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        assetSources: [
          { fileId: "no-options", fileName: "a.csv" },
          { fileId: "bad-rows", fileName: "b.csv", options: { ...options, headerRow: 0 } },
          { fileId: "bad-delim", fileName: "c.csv", options: { ...options, delimiter: "pipe" } },
          { fileId: "ok", fileName: "d.csv", options },
          { fileId: "ok", fileName: "dup.csv", options },
          { fileId: "", fileName: "e.csv", options },
        ],
      })
    );
    expect(parsed.assetSources).toEqual([{ fileId: "ok", fileName: "d.csv", options }]);
  });

  it("pruneAssetSources はどの系列も指さなくなった素材を落とす", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      series: [
        { sourceBlockId: "asset:keep", xColumn: "x", yColumn: "y" },
        { sourceBlockId: "table-1", xColumn: "x", yColumn: "y" },
      ],
      assetSources: [
        { fileId: "keep", fileName: "keep.csv", options },
        { fileId: "drop", fileName: "drop.csv", options },
      ],
    };
    const pruned = pruneAssetSources(config);
    expect(pruned.assetSources.map((a) => a.fileId)).toEqual(["keep"]);
    // 変化が無ければ同じオブジェクトを返す（無駄な再描画を起こさない）
    expect(pruneAssetSources(pruned)).toBe(pruned);
    expect(collectChartAssetFileIds(pruned)).toEqual(["keep"]);
  });

  it("suggestSeries は素材キーでもそのまま系列を組む", () => {
    const table: TableData = {
      headers: ["2theta", "I"],
      rows: [["10", "5"], ["10.5", "7"]],
    };
    expect(suggestSeries(table, "asset:f1")).toEqual([
      { sourceBlockId: "asset:f1", xColumn: "2theta", yColumn: "I" },
    ]);
  });
});
