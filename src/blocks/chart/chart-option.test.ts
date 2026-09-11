// buildOption の回帰テスト（サブプロット導入の安全網）
//
// 枠の分割（複数 grid）を入れるにあたって buildOption を一般化するが、
// 「1×1 の見た目を変えない」が不変条件なので、分割なしの図が生む ECharts の
// option をスナップショットで固定しておく。スナップショットは一般化する前の
// 実装から取ってあるので、差分が出たら既存ノートの図が変わったということ。
import { describe, expect, it } from "vitest";
import { buildOption } from "./view";
import {
  DEFAULT_CHART_CONFIG,
  DEFAULT_PANELS_CONFIG,
  DEFAULT_STACK_CONFIG,
  type ChartBlockConfig,
} from "./chart-config";
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

describe("buildOption（枠の分割）", () => {
  const split = (over: Partial<ChartBlockConfig> = {}) =>
    buildOption(
      numericResult,
      config({
        panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
        series: [
          { sourceBlockId: "t1", xColumn: "T", yColumn: "sigma", panelIndex: 0 },
          { sourceBlockId: "t1", xColumn: "T", yColumn: "kappa", panelIndex: 1 },
        ],
        ...over,
      }),
      [],
      { width: 720, height: 400 }
    );

  it("枠ごとに grid・軸を持ち、系列がその枠に割り当てられる", () => {
    const option = split();
    expect(option.grid).toHaveLength(2);
    expect(option.xAxis).toHaveLength(2);
    expect(option.yAxis).toHaveLength(2);
    expect(option.series.map((s: any) => s.xAxisIndex)).toEqual([0, 1]);
    expect(option.series.map((s: any) => s.yAxisIndex)).toEqual([0, 1]);
    // 枠ごとに軸名が決まる（明示していなければその枠の系列名）
    expect(option.yAxis.map((a: any) => a.name)).toEqual(["sigma", "kappa"]);
  });

  it("つなげない縦分割では枠が離れ、どちらの枠も X 軸のラベルを出す", () => {
    const option = split();
    const [a, b] = option.grid;
    expect(b.top).toBeGreaterThan(a.top + a.height);
    expect(option.xAxis.every((x: any) => x.axisLabel.show)).toBe(true);
    // 範囲を勝手に揃えない
    expect(option.xAxis[0].min).toBeUndefined();
  });

  it("つなげた縦分割は枠が接し、最下段だけが X 軸を名乗り、範囲が揃う", () => {
    const option = split({ panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true } });
    const [a, b] = option.grid;
    expect(b.top).toBeCloseTo(a.top + a.height, 6);
    expect(option.xAxis[0].axisLabel.show).toBe(false);
    expect(option.xAxis[0].name).toBe("");
    expect(option.xAxis[1].axisLabel.show).toBe(true);
    // 継ぎ目で上下のラベルが重ならないよう、下の枠の最大値のラベルを落とす
    expect(option.yAxis[1].axisLabel.showMaxLabel).toBe(false);
    expect(option.yAxis[0].axisLabel.showMaxLabel).toBeUndefined();
    // 共有した向きは範囲も実際に揃える（目盛りだけ下に出て縮尺が違う、を防ぐ）
    expect(option.xAxis[0].min).toBe(option.xAxis[1].min);
    expect(option.xAxis[0].max).toBe(option.xAxis[1].max);
    // 枠をまたぐ十字カーソル（axisPointer.link）はまだ入れない。
    // 入れると枠の数だけツールチップが開いて重なるため、1 つにまとめる算段が要る
    expect(option.axisPointer).toBeUndefined();
  });

  it("つなげた横分割は左端の枠だけが Y 軸を名乗る", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 1, cols: 2, joinHorizontal: true },
    });
    expect(option.yAxis[0].axisLabel.show).toBe(true);
    expect(option.yAxis[1].axisLabel.show).toBe(false);
    expect(option.yAxis[1].name).toBe("");
    expect(option.grid[1].left).toBeCloseTo(option.grid[0].left + option.grid[0].width, 6);
    // 継ぎ目で左右のラベルが重ならないよう、右の枠の最小値のラベルを落とす
    expect(option.xAxis[1].axisLabel.showMinLabel).toBe(false);
  });

  it("片方の枠だけオフセット表示にできる", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      panelStacks: [{ ...DEFAULT_STACK_CONFIG, enabled: true }],
    });
    // 枠 0 は素の縦軸（目盛りが出る）、枠 1 はオフセット表示なので目盛りを消す
    expect(option.yAxis[0].axisLabel.show).toBe(true);
    expect(option.yAxis[1].axisLabel.show).toBe(false);
  });

  it("枠数を減らすと、範囲外の系列は枠 0 に描かれる（消えない）", () => {
    const option = buildOption(
      numericResult,
      config({
        panels: DEFAULT_PANELS_CONFIG,
        series: [
          { sourceBlockId: "t1", xColumn: "T", yColumn: "sigma", panelIndex: 0 },
          { sourceBlockId: "t1", xColumn: "T", yColumn: "kappa", panelIndex: 3 },
        ],
      })
    );
    expect(option.series).toHaveLength(2);
    expect(option.grid).not.toBeInstanceOf(Array);
  });
});
