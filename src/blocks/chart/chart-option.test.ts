// buildOption の回帰テスト（サブプロット導入の安全網）
//
// 枠の分割（複数 grid）を入れるにあたって buildOption を一般化するが、
// 「1×1 の見た目を変えない」が不変条件なので、分割なしの図が生む ECharts の
// option をスナップショットで固定しておく。スナップショットは一般化する前の
// 実装から取ってあるので、差分が出たら既存ノートの図が変わったということ。
import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import { buildChart, buildOption } from "./view";
import {
  DEFAULT_CHART_CONFIG,
  DEFAULT_PANELS_CONFIG,
  DEFAULT_STACK_CONFIG,
  type ChartBlockConfig,
} from "./chart-config";
import type { ChartDataResult } from "./chart-data";
import { LEGEND_ROW_PITCH, MIN_COMPACT_PANEL_HEIGHT } from "./chart-layout";
import { CHART_LEGEND_ITEM, CHART_LEGEND_ITEM_COMPACT_WIDTH, PANEL_LABEL_INSET } from "./chart-theme";
import { scatterLegendIcon } from "./legend-icon";

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
        // 内側への寄せ幅は隅ごとに違う。文字の墨がボックスの縁に接するかどうかが
        // 上下左右で違うため、同じ数字だと下と右だけ詰まって見える
        const inset = labelPosition.endsWith("left")
          ? title.left - g.left
          : g.left + g.width - title.left;
        expect(inset).toBe(
          labelPosition.endsWith("left") ? PANEL_LABEL_INSET.left : PANEL_LABEL_INSET.right
        );
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

  it("軸名の LaTeX 記法は、枠を分けても rich text とスタイル定義の両方が載る", () => {
    // name だけ自前で置いて axisFromDetail に名前を渡さないと、記法が解釈されず
    // スタイル定義も落ちる。ECharts は素の "\\it{T}" の {T} を rich の構文として
    // 読むので、斜体にならないうえ前の字に重なって描かれる（v0.71.0 で実際に出た）
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      yAxisName: "Adfasdf\\it{T}",
      panelAxes: [{ yAxisName: "\\it{C}_{p}" }],
    });
    expect(option.yAxis[0].name).toBe("Adfasdf{it|T}");
    expect(option.yAxis[0].nameTextStyle.rich).toBeDefined();
    expect(option.yAxis[1].name).toBe("{it|C}{sub|p}");
    expect(option.yAxis[1].nameTextStyle.rich).toBeDefined();
  });

  it("記法を書いていない軸名には rich を足さない（既存の図の option を変えない）", () => {
    // 全枠が同じ名前だと図の左に 1 つへまとめられるので、枠ごとに別の名前にする
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
      yAxisName: "Intensity",
      panelAxes: [{ yAxisName: "Counts" }],
    });
    expect(option.yAxis[0].name).toBe("Intensity");
    expect(option.yAxis[0].nameTextStyle.rich).toBeUndefined();
  });

  it("右軸の名前にも記法が効く", () => {
    const option = buildOption(
      numericResult,
      config({
        panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
        series: [
          { sourceBlockId: "t1", xColumn: "T", yColumn: "a", panelIndex: 0 },
          { sourceBlockId: "t1", xColumn: "T", yColumn: "b", axis: "right", panelIndex: 0 },
        ],
        yRightAxisName: "\\it{P} (10^{5} Pa)",
      }),
      [],
      { width: 720, height: 400 }
    );
    const right = option.yAxis.find((a: any) => a.name?.includes("{it|P}"));
    expect(right).toBeDefined();
    expect(right.nameTextStyle.rich).toBeDefined();
  });

  it("枠をまたいで 1 つにした縦軸名にも記法が効く", () => {
    const option = split({
      panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true },
      yAxisName: "\\it{I} (a.u.)",
    });
    // 枠の軸は名乗らず、図の左の 1 つに寄せる
    expect(option.yAxis.map((a: any) => a.name)).toEqual(["", ""]);
    expect(option.graphic[0].style.text).toBe("{it|I} (a.u.)");
    expect(option.graphic[0].style.rich).toBeDefined();
  });

  describe("散布図系列の凡例（横並びでマーカーが前の項目に寄らない）", () => {
    it("散布図 2 系列: 記号枠を正方形に詰め、アイコンは既定のまま", () => {
      const option = buildOption(numericResult, config({ chartType: "scatter" }));
      expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM.height);
      expect(option.legend.itemHeight).toBe(CHART_LEGEND_ITEM.height);
      expect(option.legend.data).toEqual(["Intensity", "Reference"]);
    });

    it("折れ線 + 散布図: 枠 50 のまま、散布図の項目だけマーカーを右端に寄せたアイコン", () => {
      const option = buildOption(
        numericResult,
        config({
          chartType: "line",
          series: [
            { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Intensity" },
            { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Reference", type: "scatter", symbol: "emptyRect" },
          ],
        })
      );
      expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM.width);
      expect(option.legend.data).toEqual([
        "Intensity",
        { name: "Reference", icon: scatterLegendIcon("emptyRect") },
      ]);
    });

    it("縦並びの凡例は変えない", () => {
      const option = buildOption(
        numericResult,
        config({ chartType: "scatter", legendPosition: "inside-top-right", legendOrient: "vertical" })
      );
      expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM.width);
      expect(option.legend.data).toEqual(["Intensity", "Reference"]);
    });

    it("折れ線だけの凡例は変えない", () => {
      const option = buildOption(numericResult, config());
      expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM.width);
      expect(option.legend.data).toEqual(["Intensity", "Reference"]);
    });

    it("panel スコープは枠ごとの凡例の中身で決める", () => {
      const option = buildOption(
        numericResult,
        config({
          chartType: "line",
          panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
          legendScope: "panel",
          series: [
            { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Intensity", panelIndex: 0 },
            { sourceBlockId: "t1", xColumn: "2theta", yColumn: "Reference", type: "scatter", panelIndex: 1 },
          ],
        }),
        [],
        { width: 720, height: 400 }
      );
      expect(option.legend[0]).toMatchObject({ itemWidth: CHART_LEGEND_ITEM.width, data: ["Intensity"] });
      expect(option.legend[1]).toMatchObject({ itemWidth: CHART_LEGEND_ITEM.height, data: ["Reference"] });
    });
  });

  describe("凡例の範囲（legendScope）", () => {
    // 2 枠にそれぞれ同名の系列 "A" を置く（枠 0: A/B, 枠 1: A）。系列 3 本なので
    // 3 系列ぶんの点を持つ result を自前で用意する（split ヘルパーの numericResult は 2 本分）
    const threeSeriesResult: OkResult = {
      kind: "ok",
      xAxis: "value",
      categories: [],
      series: [
        { points: [[10, 1], [20, 5], [30, 2]] },
        { points: [[10, 3], [20, 1], [30, 4]] },
        { points: [[10, 2], [20, 4], [30, 1]] },
      ],
    };
    const sameNameSplit = (over: Partial<ChartBlockConfig> = {}) =>
      buildOption(
        threeSeriesResult,
        config({
          panels: { ...DEFAULT_PANELS_CONFIG, rows: 2 },
          series: [
            { sourceBlockId: "t1", xColumn: "T", yColumn: "A", panelIndex: 0 },
            { sourceBlockId: "t1", xColumn: "T", yColumn: "B", panelIndex: 0 },
            { sourceBlockId: "t1", xColumn: "T", yColumn: "A", panelIndex: 1 },
          ],
          ...over,
        }),
        [],
        { width: 720, height: 400 }
      );

    it("figure（既定）: 同じ名前の系列は枠をまたいで凡例 1 項目・同じ色にまとまる", () => {
      const option = sameNameSplit();
      expect(option.legend.data).toEqual(["A", "B"]);
      const aSeries = option.series.filter((s: any) => s.name === "A");
      expect(aSeries).toHaveLength(2);
      expect(aSeries[0].color).toBe(aSeries[1].color);
    });

    it("figure: 名前が違う系列は今までどおり別色", () => {
      const option = sameNameSplit();
      const a = option.series.find((s: any) => s.name === "A");
      const b = option.series.find((s: any) => s.name === "B");
      expect(a.color).not.toBe(b.color);
    });

    it("panel: legend が枠ごとの配列になり、data はその枠の系列名だけ", () => {
      const option = sameNameSplit({ legendScope: "panel" });
      expect(Array.isArray(option.legend)).toBe(true);
      expect(option.legend).toHaveLength(2);
      expect(option.legend[0].data).toEqual(["A", "B"]);
      expect(option.legend[1].data).toEqual(["A"]);
    });

    it("panel: 凡例の位置は枠の矩形の内側にある", () => {
      const option = sameNameSplit({ legendScope: "panel" });
      const [g0, g1] = option.grid;
      // 既定の legendPosition は top-left → inside-top-left に読み替わる
      expect(option.legend[0].left).toBeGreaterThanOrEqual(g0.left);
      expect(option.legend[0].top).toBeGreaterThanOrEqual(g0.top);
      expect(option.legend[1].left).toBeGreaterThanOrEqual(g1.left);
      expect(option.legend[1].top).toBeGreaterThanOrEqual(g1.top);
    });

    it("panel: 同じ名前の系列は枠をまたいで同じ色（凡例は系列名で色を引くため）", () => {
      const option = sameNameSplit({ legendScope: "panel" });
      const aSeries = option.series.filter((s: any) => s.name === "A");
      expect(aSeries).toHaveLength(2);
      expect(aSeries[0].color).toBe(aSeries[1].color);
    });

    it("panel: 枠ごとに凡例の隅を上書きできる（他の枠は図の設定のまま）", () => {
      const base = sameNameSplit({ legendScope: "panel", legendPosition: "inside-top-left" });
      const option = sameNameSplit({
        legendScope: "panel",
        legendPosition: "inside-top-left",
        panelLegendPositions: [null, "inside-bottom-right"],
      });
      expect(option.legend[0]).toMatchObject({ left: base.legend[0].left, top: base.legend[0].top });
      expect(option.legend[1].left).toBeUndefined();
      expect(option.legend[1].top).toBeUndefined();
      expect(typeof option.legend[1].right).toBe("number");
      expect(typeof option.legend[1].bottom).toBe("number");
    });

    it("panel: 凡例が図の上端の余白を取らない", () => {
      const figureOption = sameNameSplit({ legendScope: "figure" });
      const panelOption = sameNameSplit({ legendScope: "panel" });
      // figure スコープの top-left 凡例は上の余白を広げるが、panel スコープは
      // 枠内に収まるので gridTop（= grid[0].top）が figure より小さい
      expect(panelOption.grid[0].top).toBeLessThan(figureOption.grid[0].top);
    });
  });
});

// 狭い場所（サイドピーク等）の図。2026-09-25 の実測で、幅 224px の図の描画領域が
// 108×46px まで潰れ、目盛りラベルが重なり、凡例が設定ボタンに隠れた
describe("buildChart（狭い場所の図）", () => {
  // サイドピークに置いた 1 系列の折れ線（Minutes × Height）と同じ形
  const riseResult: OkResult = {
    kind: "ok",
    xAxis: "value",
    categories: [],
    series: [{ points: [[0, 4], [30, 5.5], [60, 7.2]] }],
  };
  const rise = (over: Partial<ChartBlockConfig> = {}) =>
    config({ series: [{ sourceBlockId: "t1", xColumn: "Minutes", yColumn: "Height" }], ...over });

  it("描画領域に最低限の高さを確保する（アスペクト比より読めることを優先）", () => {
    const { option, height } = buildChart(riseResult, rise(), [], { width: 224 });
    const plotHeight = height - option.grid.top - option.grid.bottom;
    expect(plotHeight).toBe(MIN_COMPACT_PANEL_HEIGHT);
    // 従来の余白（左 84・右 32）より描画領域の幅が広い
    expect(224 - option.grid.left - option.grid.right).toBeGreaterThan(224 - 84 - 32);
  });

  it("縦軸名は目盛りラベルのすぐ外に固定し、ECharts に動かさせない", () => {
    const { option } = buildChart(riseResult, rise(), [], { width: 224 });
    expect(option.yAxis.name).toBe("Height");
    expect(option.yAxis.nameMoveOverlap).toBe(false);
    // 軸名は余白の内側に収まる（軸名 1 行ぶん + 図の端までの隙間を残す）
    expect(option.grid.left).toBeGreaterThanOrEqual(option.yAxis.nameGap + 20);
  });

  it("短い軸は目盛りを間引き、それでも重なるラベルは隠す", () => {
    const { option } = buildChart(riseResult, rise(), [], { width: 224 });
    // 高さ 120px の縦軸 → 3 分割、幅 150px 前後の横軸 → 2 分割
    expect(option.yAxis.splitNumber).toBe(3);
    expect(option.yAxis.axisLabel.hideOverlap).toBe(true);
    expect(option.xAxis.splitNumber).toBe(2);
    expect(option.xAxis.axisLabel.hideOverlap).toBe(true);
  });

  it("カテゴリ軸は ECharts の間引きに任せる", () => {
    const { option } = buildChart(
      categoryResult,
      config({ chartType: "bar", series: [{ sourceBlockId: "t1", xColumn: "name", yColumn: "count" }] }),
      [],
      { width: 224 }
    );
    expect(option.xAxis.splitNumber).toBeUndefined();
    expect(option.xAxis.axisLabel.hideOverlap).toBeUndefined();
  });

  it("十分に広い図は従来と同じ option（目盛り・軸名・余白に何も足さない）", () => {
    const width = 564;
    const height = Math.round(width / Math.SQRT2);
    const { option, height: chartHeight, buttonAbove } = buildChart(riseResult, rise(), [], { width });
    expect(chartHeight).toBe(height);
    expect(buttonAbove).toBe(false);
    expect(option).toEqual(buildOption(riseResult, rise(), [], { width, height }));
    expect(option.grid).toMatchObject({ left: 84, right: 32, top: 48, bottom: 64 });
    expect(option.yAxis.splitNumber).toBeUndefined();
    expect(option.yAxis.nameMoveOverlap).toBeUndefined();
    expect(option.yAxis.nameGap).toBe(52);
    expect(option.xAxis.splitNumber).toBeUndefined();
    expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM.width);
  });

  it("凡例の記号枠を短くし、入りきらない名前は末尾を省略してホバーで全文を出す", () => {
    const { option } = buildChart(riseResult, rise(), [], { width: 224 });
    expect(option.legend.itemWidth).toBe(CHART_LEGEND_ITEM_COMPACT_WIDTH);
    expect(option.legend.textStyle.overflow).toBe("truncate");
    expect(option.legend.textStyle.width).toBeGreaterThan(0);
    expect(option.legend.tooltip).toEqual({ show: true });
  });

  it("分割した図は枠の左端が揃う（軸名を ECharts に動かさせない）", () => {
    const { option } = buildChart(
      numericResult,
      config({
        panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true },
        series: [
          { sourceBlockId: "t1", xColumn: "T", yColumn: "Height", panelIndex: 0 },
          { sourceBlockId: "t1", xColumn: "T", yColumn: "Temperature", panelIndex: 1 },
        ],
      }),
      [],
      { width: 224 }
    );
    expect(option.grid).toHaveLength(2);
    expect(option.grid[1].left).toBe(option.grid[0].left);
    expect(option.grid[1].width).toBe(option.grid[0].width);
    expect(option.grid.map((g: any) => g.height)).toEqual([MIN_COMPACT_PANEL_HEIGHT, MIN_COMPACT_PANEL_HEIGHT]);
    expect(option.yAxis.every((a: any) => a.nameMoveOverlap === false)).toBe(true);
  });

  it("ECharts の実レイアウト（SSR）でも、ラベルの長さが違う枠どうしの左端が揃う", () => {
    // 上の枠は 1 桁（4〜8）、下の枠は "24.5" のような 4 文字のラベル。固定の余白で
    // 詰めていたときは、下の枠だけ軸名が逃がされ、その枠だけ 12px 縮んでずれた
    const twoRanges: OkResult = {
      kind: "ok",
      xAxis: "value",
      categories: [],
      series: [
        { points: [[0, 4], [30, 5.5], [60, 7.2]] },
        { points: [[0, 24.1], [30, 25.3], [60, 26]] },
      ],
    };
    const { option, height } = buildChart(
      twoRanges,
      config({
        panels: { ...DEFAULT_PANELS_CONFIG, rows: 2, joinVertical: true },
        series: [
          { sourceBlockId: "t1", xColumn: "Minutes", yColumn: "Height", panelIndex: 0 },
          { sourceBlockId: "t1", xColumn: "Minutes", yColumn: "Temperature", panelIndex: 1 },
        ],
      }),
      [],
      { width: 224 }
    );
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 224, height }) as any;
    chart.setOption(option);
    const rects = [0, 1].map((i) => chart.getModel().getComponent("grid", i).coordinateSystem.getRect());
    chart.dispose();
    // ECharts が枠を縮めていない（option どおり）ので、上下の枠の左端と幅が揃う
    expect(rects[0].x).toBeCloseTo(option.grid[0].left, 5);
    expect(rects[1].x).toBeCloseTo(option.grid[1].left, 5);
    expect(rects[1].x).toBeCloseTo(rects[0].x, 5);
    expect(rects[1].width).toBeCloseTo(rects[0].width, 5);
  });

  describe("設定ボタンの置き場所", () => {
    it("狭い図はボタンを図の上の行に置く（凡例も枠もボタンの下に来るため）", () => {
      expect(buildChart(riseResult, rise(), [], { width: 224, coverTopRight: 63 }).buttonAbove).toBe(true);
    });

    it("ボタンが無い・図に掛かっていないときは上の行を取らない", () => {
      expect(buildChart(riseResult, rise(), [], { width: 224 }).buttonAbove).toBe(false);
      expect(
        buildChart(riseResult, rise({ legendPosition: "top-right" }), [], { width: 720, coverTopRight: 0 })
          .buttonAbove
      ).toBe(false);
    });

    it("広い図でも、枠の上・右端揃えの凡例がボタンの下に潜るときは上の行へ逃がす", () => {
      const topRight = buildChart(riseResult, rise({ legendPosition: "top-right" }), [], {
        width: 564,
        coverTopRight: 63,
      });
      expect(topRight.buttonAbove).toBe(true);
      // 図そのものは変えない（ボタンだけが動く）
      expect(topRight.option).toEqual(
        buildOption(riseResult, rise({ legendPosition: "top-right" }), [], { width: 564, height: topRight.height })
      );
      // 左上の凡例はボタンに掛からない幅で折り返すので、ボタンは重ねたまま
      expect(buildChart(riseResult, rise(), [], { width: 564, coverTopRight: 63 }).buttonAbove).toBe(false);
    });

    it("ボタンが重なったままなら、凡例はボタンが覆う幅の手前で折り返す（英語の Settings は 87px）", () => {
      const width = 564;
      const legendWidthOf = (coverTopRight: number) =>
        buildChart(riseResult, rise(), [], { width, coverTopRight }).option.legend.width;
      // 日本語の「設定」（63px）は従来の 72px の空きに収まる
      expect(legendWidthOf(63)).toBe(width - 84 - 72);
      expect(legendWidthOf(87)).toBe(width - 84 - (87 + 8));
    });
  });
});

// 通常の幅の図の凡例。以前は折り返し 1 行を 17px で空けていたので、上に置いた凡例は
// 4 行で枠に接し、5 行以上で最終行が枠に食い込んだ（2026-09-25 の実測。行送りは 24px）
describe("buildChart（通常の幅の凡例の折り返し）", () => {
  const names = ["A", "B", "C", "D", "E", "F"].map((s, k) => `試料 ${s}（${200 + 100 * k} ℃ 焼成）`);
  const sixSeries: OkResult = {
    kind: "ok",
    xAxis: "value",
    categories: [],
    series: names.map((_, k) => ({ points: [[300, 900 - 45 * k], [800, 500 - 45 * k]] as Array<[number, number]> })),
  };
  const sixConfig = (over: Partial<ChartBlockConfig> = {}) =>
    config({
      series: names.map((label) => ({ sourceBlockId: "t1", xColumn: "T (K)", yColumn: "sigma", label })),
      ...over,
    });

  it("1 行に 1 項目しか入らない長い名前は、行数ぶん（1 行 24px）枠を下げる", () => {
    const { option } = buildChart(sixSeries, sixConfig(), [], { width: 564 });
    expect(option.grid.top).toBe(48 + 5 * LEGEND_ROW_PITCH);
  });

  it("下に置いた凡例も、行数ぶん枠の下を空ける", () => {
    const { option } = buildChart(sixSeries, sixConfig({ legendPosition: "bottom" }), [], { width: 564 });
    expect(option.grid.bottom).toBe(64 + 32 + 5 * LEGEND_ROW_PITCH);
  });
});
