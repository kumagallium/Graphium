// buildOption の回帰テスト（サブプロット導入の安全網）
//
// 枠の分割（複数 grid）を入れるにあたって buildOption を一般化するが、
// 「1×1 の見た目を変えない」が不変条件なので、分割なしの図が生む ECharts の
// option をスナップショットで固定しておく。スナップショットは一般化する前の
// 実装から取ってあるので、差分が出たら既存ノートの図が変わったということ。
import { describe, expect, it } from "vitest";
import { buildOption } from "./view";
import { DEFAULT_CHART_CONFIG, type ChartBlockConfig } from "./chart-config";
import type { ChartDataResult } from "./chart-data";

type OkResult = Extract<ChartDataResult, { kind: "ok" }>;

const numericResult: OkResult = {
  kind: "ok",
  xAxis: "value",
  categories: [],
  series: [
    { points: [[10, 1], [20, 5], [30, 2]] },
    { points: [[10, 3], [20, 1], [30, 4]] },
  ],
};

const categoryResult: OkResult = {
  kind: "ok",
  xAxis: "category",
  categories: ["A", "B", "C"],
  series: [{ points: [1, 2, null] }],
};

const config = (over: Partial<ChartBlockConfig> = {}): ChartBlockConfig => ({
  ...DEFAULT_CHART_CONFIG,
  series: [
    { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Intensity" },
    { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Reference" },
  ],
  ...over,
});

describe("buildOption（分割なしの回帰）", () => {
  it("折れ線（既定）", () => {
    expect(buildOption(numericResult, config())).toMatchSnapshot();
  });

  it("軸名・範囲・凡例の位置を指定", () => {
    expect(
      buildOption(
        numericResult,
        config({
          xAxisName: "2θ (deg)",
          yAxisName: "Intensity",
          xMin: "10",
          xMax: "30",
          legendPosition: "inside-top-right",
          legendOrient: "vertical",
        })
      )
    ).toMatchSnapshot();
  });

  it("オフセット表示", () => {
    expect(
      buildOption(
        numericResult,
        config({ stack: { ...DEFAULT_CHART_CONFIG.stack, enabled: true } })
      )
    ).toMatchSnapshot();
  });

  it("第 2 軸", () => {
    expect(
      buildOption(
        numericResult,
        config({
          series: [
            { sourceBlockId: "t1", xColumn: "T", yColumn: "sigma" },
            { sourceBlockId: "t1", xColumn: "T", yColumn: "S", axis: "right" },
          ],
          yRightAxisName: "S",
        })
      )
    ).toMatchSnapshot();
  });

  it("棒・カテゴリ軸", () => {
    expect(
      buildOption(
        categoryResult,
        config({
          chartType: "bar",
          series: [{ sourceBlockId: "t1", xColumn: "name", yColumn: "count" }],
        })
      )
    ).toMatchSnapshot();
  });
});
