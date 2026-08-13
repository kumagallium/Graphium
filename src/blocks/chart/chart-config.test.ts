// chart-config.ts（設定 JSON のパース・デフォルト埋め・旧形式マイグレーション）のテスト

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHART_CONFIG,
  parseChartBlockConfig,
  serializeChartBlockConfig,
  seriesConfigDisplayName,
  suggestSeries,
  usesRightAxis,
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
