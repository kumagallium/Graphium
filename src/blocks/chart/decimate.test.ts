import { describe, expect, it } from "vitest";
import {
  CHART_MAX_DRAWN_POINTS,
  clipToRange,
  decimateSeriesPoints,
  needsDecimation,
  decimateEvenPoints,
  decimateLinePoints,
} from "./decimate";
import type { ChartDataResult } from "./chart-data";

type Point = [number, number];
const wave = (n: number): Point[] =>
  Array.from({ length: n }, (_, i) => [i, Math.sin(i / 37) * 100 + (i % 101 === 0 ? 500 : 0) - (i % 211 === 0 ? 400 : 0)]);

describe("decimateLinePoints", () => {
  it("上限以下は同じ配列を返す", () => {
    const pts = wave(CHART_MAX_DRAWN_POINTS);
    expect(decimateLinePoints(pts)).toBe(pts);
  });

  it("点数が上限以下になり、順序（X の昇順）が保たれる", () => {
    const out = decimateLinePoints(wave(233_000));
    expect(out.length).toBeLessThanOrEqual(CHART_MAX_DRAWN_POINTS);
    expect(out.length).toBeGreaterThan(CHART_MAX_DRAWN_POINTS / 2);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });

  it("全体の最小・最大（山と谷）と最初・最後が残る", () => {
    const pts = wave(233_000);
    const out = decimateLinePoints(pts);
    const ys = pts.map((p) => p[1]);
    const outYs = out.map((p) => p[1]);
    expect(outYs.reduce((a, b) => Math.max(a, b))).toBe(ys.reduce((a, b) => Math.max(a, b)));
    expect(outYs.reduce((a, b) => Math.min(a, b))).toBe(ys.reduce((a, b) => Math.min(a, b)));
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
  });

  it("1 点だけの鋭いスパイクを落とさない", () => {
    const pts: Point[] = Array.from({ length: 50_000 }, (_, i) => [i, 1]);
    pts[31_337] = [31_337, 9_999];
    const out = decimateLinePoints(pts);
    expect(out.some((p) => p[1] === 9_999)).toBe(true);
  });

  it("同じ入力なら同じ出力（乱数を使わない）", () => {
    expect(decimateLinePoints(wave(20_000))).toEqual(decimateLinePoints(wave(20_000)));
  });
});

describe("decimateEvenPoints", () => {
  it("上限以下は同じ配列を返す", () => {
    const pts = wave(100);
    expect(decimateEvenPoints(pts)).toBe(pts);
  });

  it("等間隔に抜き、先頭と末尾を残し、順序と上限を守る", () => {
    const pts = wave(100_000);
    const out = decimateEvenPoints(pts);
    expect(out.length).toBeLessThanOrEqual(CHART_MAX_DRAWN_POINTS);
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
    for (let i = 1; i < out.length; i++) expect(out[i][0]).toBeGreaterThan(out[i - 1][0]);
  });
});

describe("clipToRange", () => {
  const pts: Point[] = Array.from({ length: 11 }, (_, i) => [i, i]);
  it("範囲なし・全点が範囲内なら同じ配列", () => {
    expect(clipToRange(pts, null)).toBe(pts);
    expect(clipToRange(pts, { min: null, max: null })).toBe(pts);
    expect(clipToRange(pts, { min: -5, max: 50 })).toBe(pts);
  });
  it("範囲の外を落とし、端まで線が届くよう外側の隣を 1 点ずつ残す", () => {
    const out = clipToRange(pts, { min: 3, max: 6 });
    expect(out.map((p) => p[0])).toEqual([2, 3, 4, 5, 6, 7]);
  });
});

describe("decimateSeriesPoints", () => {
  it("上限以下は同じ配列（範囲の指定があっても切り出さない）", () => {
    const pts = wave(100);
    expect(decimateSeriesPoints(pts, "line")).toBe(pts);
    expect(decimateSeriesPoints(pts, "scatter", { min: 20, max: 40 })).toBe(pts);
  });

  it("折れ線は最小・最大を残し、散布図・棒は等間隔（点数が違う）", () => {
    const pts = wave(100_000);
    const line = decimateSeriesPoints(pts, "line");
    const scatter = decimateSeriesPoints(pts, "scatter");
    expect(line.length).toBeLessThanOrEqual(CHART_MAX_DRAWN_POINTS);
    expect(scatter.length).toBe(CHART_MAX_DRAWN_POINTS);
    expect(decimateSeriesPoints(pts, "bar")).toEqual(scatter);
  });

  it("X の範囲を絞ると見えている部分だけが対象になる（範囲内が上限以下なら全点）", () => {
    const out = decimateSeriesPoints(wave(100_000), "line", { min: 1000, max: 1999 });
    expect(out.length).toBe(1002);
  });

  it("同じ長さの系列は、同じ位置（添字）の点が残る（積み上げ棒が崩れない）", () => {
    const a = Array.from({ length: 50_000 }, (_, i): Point => [i, 1]);
    const b = Array.from({ length: 50_000 }, (_, i): Point => [i, 2]);
    const da = decimateSeriesPoints(a, "bar");
    const db = decimateSeriesPoints(b, "bar");
    expect(da.map((p) => p[0])).toEqual(db.map((p) => p[0]));
  });
});

describe("needsDecimation", () => {
  const ok = (series: Point[][], xAxis: "value" | "category" = "value"): Extract<ChartDataResult, { kind: "ok" }> => ({
    kind: "ok",
    xAxis,
    categories: [],
    series: series.map((points) => ({ points })),
  });
  it("上限を超える系列があれば true、無ければ false", () => {
    expect(needsDecimation(ok([wave(100)]), "line")).toBe(false);
    expect(needsDecimation(ok([wave(100), wave(100_000)]), "line")).toBe(true);
  });
  it("見えている範囲が上限以下なら false。ヒストグラムとカテゴリ軸は常に false", () => {
    expect(needsDecimation(ok([wave(100_000)]), "line", [{ range: { min: 10, max: 500 } }])).toBe(false);
    expect(needsDecimation(ok([wave(100_000)]), "histogram")).toBe(false);
    expect(needsDecimation(ok([wave(100_000)], "category"), "bar")).toBe(false);
  });
});
