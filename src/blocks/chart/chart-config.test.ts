// chart-config.ts（設定 JSON のパース・デフォルト埋め）のテスト

import { describe, it, expect } from "vitest";
import {
  DEFAULT_CHART_CONFIG,
  parseChartBlockConfig,
  serializeChartBlockConfig,
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
    };
    expect(parseChartBlockConfig(serializeChartBlockConfig(config))).toEqual(config);
  });
});
