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
    // つないだ列は十字カーソルも連動する（詳細は別のテストで）
    expect(option.axisPointer.link).toEqual([{ xAxisIndex: [0, 1] }]);
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

  it("枠ごとに軸名と範囲を持てる", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      // 枠 0 はチャート側のキー、枠 1 は panelAxes
      yAxisName: "σ (S/cm)",
      yMin: "0",
      yMax: "1000",
      panelAxes: [{ yAxisName: "κ (W/mK)", yMin: "1", yMax: "4" }],
    });
    expect(option.yAxis.map((a: any) => a.name)).toEqual(["σ (S/cm)", "κ (W/mK)"]);
    expect(option.yAxis.map((a: any) => a.min)).toEqual([0, 1]);
    expect(option.yAxis.map((a: any) => a.max)).toEqual([1000, 4]);
  });

  it("縦につなげた列は、最上段の枠が持つ X の範囲を全段が使う", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true },
      xMin: "12",
      xMax: "58",
      // 下段が別の範囲を持っていても、つないでいる間は持ち主（最上段）が勝つ
      panelAxes: [{ xMin: "0", xMax: "100" }],
    });
    expect(option.xAxis.map((a: any) => a.min)).toEqual([12, 12]);
    expect(option.xAxis.map((a: any) => a.max)).toEqual([58, 58]);
  });

  it("つなげていなければ、枠ごとの X の範囲がそのまま効く", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      xMin: "12",
      xMax: "58",
      panelAxes: [{ xMin: "0", xMax: "100" }],
    });
    expect(option.xAxis.map((a: any) => a.min)).toEqual([12, 0]);
    expect(option.xAxis.map((a: any) => a.max)).toEqual([58, 100]);
  });

  it("枠の記号は分割して、明示的に入れたときだけ出る", () => {
    expect(split().title).toBeUndefined();
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, showPanelLabels: true },
    });
    expect(option.title.map((tt: any) => tt.text)).toEqual(["(a)", "(b)"]);
    // 記号は枠の内側（左上）に置く。外に出すとつなげた上の枠へ食い込む
    expect(option.title[0].left).toBeGreaterThanOrEqual(option.grid[0].left);
    expect(option.title[1].top).toBeGreaterThanOrEqual(option.grid[1].top);
  });

  it("記号は指定した隅を基準に置く（座標だけ動かすと枠からはみ出す）", () => {
    // left / top をどの角として扱うかは title の textAlign / textVerticalAlign。
    // ここが left/top のままだと、右下を選んでも文字が右下へ伸びて枠の外に出る
    const corners = {
      "top-left": { textAlign: "left", textVerticalAlign: "top" },
      "top-right": { textAlign: "right", textVerticalAlign: "top" },
      "bottom-left": { textAlign: "left", textVerticalAlign: "bottom" },
      "bottom-right": { textAlign: "right", textVerticalAlign: "bottom" },
    } as const;
    for (const [labelPosition, expected] of Object.entries(corners)) {
      const option = split({
        panels: {
          ...DEFAULT_PANELS_CONFIG,
          rows: 2,
          showPanelLabels: true,
          labelPosition: labelPosition as keyof typeof corners,
        },
      });
      for (const [i, title] of option.title.entries()) {
        expect(title.textAlign).toBe(expected.textAlign);
        expect(title.textVerticalAlign).toBe(expected.textVerticalAlign);
        // 基準点そのものも枠の矩形の内側にある
        const g = option.grid[i];
        expect(title.left).toBeGreaterThanOrEqual(g.left);
        expect(title.left).toBeLessThanOrEqual(g.left + g.width);
        expect(title.top).toBeGreaterThanOrEqual(g.top);
        expect(title.top).toBeLessThanOrEqual(g.top + g.height);
      }
    }
  });

  it("全枠の縦軸名が同じなら、図の左に 1 つだけ置く", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true },
      yAxisName: "Intensity",
    });
    // 枠の軸は名乗らない
    expect(option.yAxis.map((a: any) => a.name)).toEqual(["", ""]);
    expect(option.graphic).toHaveLength(1);
    expect(option.graphic[0].style.text).toBe("Intensity");
    // 縦は全枠の中央
    const top = Math.min(...option.grid.map((g: any) => g.top));
    const bottom = Math.max(...option.grid.map((g: any) => g.top + g.height));
    expect(option.graphic[0].top).toBeCloseTo((top + bottom) / 2, 6);
  });

  it("縦軸名が枠ごとに違えば、統合せず枠ごとに出す", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      yAxisName: "σ (S/cm)",
      panelAxes: [{ yAxisName: "κ (W/mK)" }],
    });
    expect(option.graphic).toBeUndefined();
    expect(option.yAxis.map((a: any) => a.name)).toEqual(["σ (S/cm)", "κ (W/mK)"]);
  });

  it("十字カーソルの連動は、縦につないだ列の中だけ", () => {
    // つないでいなければ枠は別の図なので連動させない
    expect(split().axisPointer).toBeUndefined();
    // 横につないだだけ（Y の共有）も X とは関係ないので連動させない
    expect(
      split({ panels: { ...DEFAULT_PANELS_CONFIG, rows: 1, cols: 2, joinHorizontal: true } })
        .axisPointer
    ).toBeUndefined();

    const joined = split({ panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true } });
    expect(joined.axisPointer.link).toEqual([{ xAxisIndex: [0, 1] }]);
    // 2 列あるときは列ごとに別のグループ（隣の列は別の X を持ちうる）
    const twoCols = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, cols: 2, joinVertical: true },
    });
    expect(twoCols.axisPointer.link).toEqual([{ xAxisIndex: [0, 2] }, { xAxisIndex: [1, 3] }]);
  });

  it("つないだ列のツールチップは 1 つにまとまる", () => {
    const joined = split({ panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true } });
    const formatter = joined.tooltip.formatter;
    expect(typeof formatter).toBe("function");
    // 最上段の枠の系列（option 上の添字 0）が本文を出す係
    const body = formatter([{ seriesIndex: 0, axisValue: 20, value: [20, 5] }]);
    expect(body).toContain("sigma");
    expect(body).toContain("kappa");
    // 下の段のぶんは空にして、同じ内容の箱が段の数だけ開くのを防ぐ
    expect(formatter([{ seriesIndex: 1, axisValue: 20, value: [20, 5] }])).toBe("");
  });
});
