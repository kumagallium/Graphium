// 散布図系列の凡例（legend-icon.ts）のテスト
//
// アイコン文字列の形だけでなく、ECharts を SSR で実際に動かし、凡例の項目が
// 「マーカーは前の項目のラベルより自分のラベルの近くにある」並びになることを確かめる。
import { describe, expect, it } from "vitest";
import * as echarts from "echarts";
import type { SeriesSymbolShape } from "./chart-config";
import { CHART_LEGEND_ITEM } from "./chart-theme";
import { legendItems, scatterLegendIcon } from "./legend-icon";

const { createSymbol } = echarts.helper;

const W = CHART_LEGEND_ITEM.width;
const H = CHART_LEGEND_ITEM.height;
const SHAPES: SeriesSymbolShape[] = [
  "circle",
  "emptyCircle",
  "rect",
  "emptyRect",
  "triangle",
  "emptyTriangle",
  "diamond",
  "emptyDiamond",
];

describe("scatterLegendIcon", () => {
  it.each(SHAPES)("%s: bbox は記号枠いっぱい、マーカーは枠の右端に既定と同じ寸法で描く", (shape) => {
    const icon = scatterLegendIcon(shape);
    // ECharts の凡例と同じ呼び方（枠 0,0,W,H・縦横比保持）で作る
    const whole = createSymbol(icon, 0, 0, W, H, "#000", true) as any;
    const rect = whole.getBoundingRect();
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(W);

    // 左端の見えない点を外すと、既定のマーカーを枠の右端の正方形に置いたものと一致する
    const markerOnly = createSymbol(icon.replace(`M0 ${H / 2}`, ""), W - H, 0, H, H, "#000", true) as any;
    const builtin = createSymbol(shape, W - H, 0, H, H, "#000", true) as any;
    expect(markerOnly.getBoundingRect()).toMatchObject({ ...builtin.getBoundingRect() });
  });

  it("白抜きは emptypath:// になる（ECharts が白塗り + 線で描く）", () => {
    expect(scatterLegendIcon("emptyCircle").startsWith("emptypath://")).toBe(true);
    expect(scatterLegendIcon("circle").startsWith("path://")).toBe(true);
  });
});

describe("legendItems", () => {
  const line = (name: string) => ({ name, scatterSymbol: null });
  const scatter = (name: string, symbol: SeriesSymbolShape = "circle") => ({ name, scatterSymbol: symbol });

  it("散布図を含まない凡例は従来どおり（名前だけ・枠 50）", () => {
    expect(legendItems([line("A"), line("B")], "horizontal")).toEqual({ data: ["A", "B"], itemWidth: W });
  });

  it("横並びで全項目が散布図なら、記号枠を正方形に詰める（アイコンは既定のまま）", () => {
    expect(legendItems([scatter("S"), scatter("zT")], "horizontal")).toEqual({
      data: ["S", "zT"],
      itemWidth: H,
    });
  });

  it("横並びで折れ線と混在するなら、枠 50 のまま散布図の項目だけアイコンを差し替える", () => {
    const spec = legendItems([line("σ"), scatter("S", "emptyTriangle")], "horizontal");
    expect(spec.itemWidth).toBe(W);
    expect(spec.data).toEqual(["σ", { name: "S", icon: scatterLegendIcon("emptyTriangle") }]);
  });

  it("縦並びは 1 項目 1 行で前の項目と並ばないので、何も変えない", () => {
    expect(legendItems([line("σ"), scatter("S")], "vertical")).toEqual({ data: ["σ", "S"], itemWidth: W });
    expect(legendItems([scatter("S"), scatter("zT")], "vertical")).toEqual({ data: ["S", "zT"], itemWidth: W });
  });
});

describe("ECharts の実レイアウト（SSR）", () => {
  type Placed = { markerLeft: number; markerRight: number; textLeft: number; textRight: number };

  /** 横並びの凡例を実際に並べさせ、各項目のマーカーとラベルの横位置(px)を返す */
  const layoutLegend = (
    series: Array<{ name: string; type: "line" | "scatter"; symbol?: string }>,
    legend: { data: Array<string | { name: string; icon: string }>; itemWidth: number }
  ): Placed[] => {
    const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 720, height: 400 }) as any;
    chart.setOption({
      animation: false,
      xAxis: { type: "value" },
      yAxis: { type: "value" },
      legend: {
        show: true,
        left: 0,
        top: 0,
        orient: "horizontal",
        data: legend.data,
        itemWidth: legend.itemWidth,
        itemHeight: H,
        textStyle: { fontSize: 16 },
      },
      series: series.map((s) => ({ ...s, data: [[1, 2], [2, 3]] })),
    });
    const view = chart.getViewOfComponentModel(chart.getModel().getComponent("legend"));
    const placed = view
      .getContentGroup()
      .children()
      .map((group: any, k: number) => {
        const [icon, text] = group.children();
        const item = legend.data[k];
        // 差し替えたアイコンは bbox が枠いっぱいなので、マーカーの位置は枠の右端の正方形
        const iconRect = icon.getBoundingRect();
        const markerLeft = typeof item === "object" ? legend.itemWidth - H : iconRect.x;
        const markerRight = typeof item === "object" ? legend.itemWidth : iconRect.x + iconRect.width;
        const textRect = text.getBoundingRect();
        return {
          markerLeft: group.x + markerLeft,
          markerRight: group.x + markerRight,
          textLeft: group.x + textRect.x,
          textRight: group.x + textRect.x + textRect.width,
        };
      });
    chart.dispose();
    return placed;
  };

  /** 散布図の項目 k のマーカーが、前の項目のラベルより自分のラベルに近いか */
  const expectMarkerNearOwnLabel = (placed: Placed[], k: number) => {
    const toOwnLabel = placed[k].textLeft - placed[k].markerRight;
    const fromPrevLabel = placed[k].markerLeft - placed[k - 1].textRight;
    expect(fromPrevLabel).toBeGreaterThan(0);
    expect(fromPrevLabel).toBeGreaterThan(toOwnLabel);
  };

  const scatterSeries = [
    { name: "S", type: "scatter" as const },
    { name: "zT", type: "scatter" as const },
  ];

  it("修正前の再現: 既定の枠 50 だと散布図のマーカーが前のラベルに寄る", () => {
    const placed = layoutLegend(scatterSeries, { data: ["S", "zT"], itemWidth: W });
    const toOwnLabel = placed[1].textLeft - placed[1].markerRight;
    const fromPrevLabel = placed[1].markerLeft - placed[0].textRight;
    expect(fromPrevLabel).toBeLessThan(toOwnLabel);
  });

  it("散布図 2 系列: マーカーが自分のラベルの側に来る", () => {
    const spec = legendItems(
      scatterSeries.map((s) => ({ name: s.name, scatterSymbol: "circle" })),
      "horizontal"
    );
    expectMarkerNearOwnLabel(layoutLegend(scatterSeries, spec), 1);
  });

  it("折れ線 + 散布図の混在: 散布図のマーカーが自分のラベルの側に来る", () => {
    const mixed = [
      { name: "σ", type: "line" as const },
      { name: "S", type: "scatter" as const },
      { name: "zT", type: "scatter" as const, symbol: "emptyDiamond" },
    ];
    const spec = legendItems(
      [
        { name: "σ", scatterSymbol: null },
        { name: "S", scatterSymbol: "circle" },
        { name: "zT", scatterSymbol: "emptyDiamond" },
      ],
      "horizontal"
    );
    const placed = layoutLegend(mixed, spec);
    expectMarkerNearOwnLabel(placed, 1);
    expectMarkerNearOwnLabel(placed, 2);
  });
});
