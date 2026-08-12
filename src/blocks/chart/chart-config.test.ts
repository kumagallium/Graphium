// chart-config.ts（設定 JSON のパース・デフォルト埋め）のテスト

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHART_CONFIG,
  parseChartBlockConfig,
  serializeChartBlockConfig,
  seriesDisplayName,
  usesRightAxis,
} from "./chart-config";

describe("parseChartBlockConfig", () => {
  it("空文字・壊れた JSON はデフォルトに落ちる", () => {
    expect(parseChartBlockConfig("")).toEqual(DEFAULT_CHART_CONFIG);
    expect(parseChartBlockConfig("{broken")).toEqual(DEFAULT_CHART_CONFIG);
    expect(parseChartBlockConfig("null")).toEqual(DEFAULT_CHART_CONFIG);
  });

  it("欠けたフィールドはデフォルトで埋まる（後方互換）", () => {
    const parsed = parseChartBlockConfig(JSON.stringify({ chartType: "bar", xColumn: "日時" }));
    expect(parsed.chartType).toBe("bar");
    expect(parsed.xColumn).toBe("日時");
    expect(parsed.aspect).toBe("standard");
    expect(parsed.showLegend).toBe(true);
    expect(parsed.showFrame).toBe(true);
    expect(parsed.showGrid).toBe(false);
  });

  it("不正な値は既定に矯正される", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        chartType: "pie",
        aspect: "cinema",
        legendPosition: "middle",
        yColumns: ["a", 1, null, "b"],
      })
    );
    expect(parsed.chartType).toBe("line");
    expect(parsed.aspect).toBe("standard");
    expect(parsed.legendPosition).toBe("top-left");
    expect(parsed.yColumns).toEqual(["a", "b"]);
  });

  it("serialize → parse で往復できる", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      chartType: "scatter" as const,
      xColumn: "気圧",
      yColumns: ["痛み"],
      caption: "気圧と頭痛強度",
      yMin: "0",
      yMax: "10",
      aspect: "square" as const,
      showGrid: true,
      seriesOptions: { 痛み: { label: "頭痛", color: "#2563EB", axis: "right" as const } },
      legendPosition: "inside-top-right" as const,
      legendOrient: "vertical" as const,
      yRightAxisName: "頭痛強度",
    };
    expect(parseChartBlockConfig(serializeChartBlockConfig(config))).toEqual(config);
  });

  it("seriesOptions は不正値を落とし、空エントリを残さない", () => {
    const parsed = parseChartBlockConfig(
      JSON.stringify({
        seriesOptions: {
          a: { label: "A 系列", axis: "right" },
          b: { axis: "left" },
          c: { label: "", color: "" },
          d: "not-an-object",
        },
      })
    );
    expect(parsed.seriesOptions).toEqual({ a: { label: "A 系列", axis: "right" } });
  });

  it("seriesDisplayName / usesRightAxis", () => {
    const config = {
      ...DEFAULT_CHART_CONFIG,
      yColumns: ["痛み", "気圧"],
      seriesOptions: { 気圧: { axis: "right" as const }, 痛み: { label: "頭痛" } },
    };
    expect(seriesDisplayName(config, "痛み")).toBe("頭痛");
    expect(seriesDisplayName(config, "気圧")).toBe("気圧");
    expect(usesRightAxis(config)).toBe(true);
    expect(usesRightAxis(DEFAULT_CHART_CONFIG)).toBe(false);
  });
});
