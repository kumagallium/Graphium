// チャートの描画用データの間引き（純関数のみ）
//
// 点が数十万あっても、画面の幅は数百〜千数百 px。SVG で全点を描くと、ECharts が
// 点ごとに要素を作って測るので数十秒固まる。描画に渡す点だけを間引き、元の表・
// 計算・設定には触れない。
//
// - 折れ線: 行の順のまま連続する区間に分け、各区間の「最初・最小・最大・最後」を元の順で
//   残す。区間の中の山と谷を落とさないので、線の形が変わらない
// - 散布図・棒: 等間隔に抜く（決まった規則。乱数は使わない）
// - ヒストグラムはここに来ない（集計は全点で行ってから描く）。カテゴリ軸の系列は
//   ラベルと整列した配列なので間引かない

import type { ChartDataResult, ChartType } from "./chart-data";

/** 1 系列あたり描く点の上限。これを超えたら描画用のデータだけを間引く */
export const CHART_MAX_DRAWN_POINTS = 4000;

type Point = [number, number];

/** 折れ線用: 区間ごとに「最初・最小・最大・最後」を元の順で残す。上限以下なら同じ配列 */
export function decimateLinePoints(points: Point[], max: number = CHART_MAX_DRAWN_POINTS): Point[] {
  const n = points.length;
  if (n <= max) return points;
  // 1 区間から最大 4 点残るので、区間数は max / 4
  const buckets = Math.max(1, Math.floor(max / 4));
  const out: Point[] = [];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.floor(((b + 1) * n) / buckets) - 1; // 含む
    if (to < from) continue;
    let minI = from;
    let maxI = from;
    for (let i = from + 1; i <= to; i++) {
      if (points[i][1] < points[minI][1]) minI = i;
      if (points[i][1] > points[maxI][1]) maxI = i;
    }
    // 元の順に並べて重複を除く（最初・最小・最大・最後）
    const picks = [from, minI, maxI, to].sort((a, c) => a - c);
    let last = -1;
    for (const i of picks) {
      if (i === last) continue;
      out.push(points[i]);
      last = i;
    }
  }
  return out;
}

/** 散布図・棒用: 等間隔に抜く（先頭と末尾は残る）。上限以下なら同じ配列 */
export function decimateEvenPoints(points: Point[], max: number = CHART_MAX_DRAWN_POINTS): Point[] {
  const n = points.length;
  if (n <= max) return points;
  const out: Point[] = [];
  let last = -1;
  for (let k = 0; k < max; k++) {
    const i = Math.round((k * (n - 1)) / (max - 1));
    if (i === last) continue;
    out.push(points[i]);
    last = i;
  }
  return out;
}

/** 見えている X の範囲（null は無制限）。範囲の外の点は描かれないので、間引きの対象にしない */
export type VisibleRange = { min: number | null; max: number | null };

/**
 * X の範囲に入る点だけを取り出す。線が枠の端まで届くよう、範囲の外の隣の点を 1 つずつ残す。
 * 範囲が無い・全点が範囲内なら同じ配列。points は X の昇順（buildChartData が整える）
 */
export function clipToRange(points: Point[], range: VisibleRange | null | undefined): Point[] {
  if (!range || (range.min === null && range.max === null)) return points;
  let lo = 0;
  let hi = points.length - 1;
  if (range.min !== null) {
    while (lo < points.length && points[lo][0] < range.min) lo++;
    lo = Math.max(0, lo - 1);
  }
  if (range.max !== null) {
    while (hi >= 0 && points[hi][0] > range.max) hi--;
    hi = Math.min(points.length - 1, hi + 1);
  }
  if (lo === 0 && hi === points.length - 1) return points;
  return hi < lo ? [] : points.slice(lo, hi + 1);
}

/**
 * ECharts に渡す直前の点の間引き（1 系列）。上限以下の系列は同じ配列をそのまま返す
 * （上限以下のチャートは、渡す内容が間引きの導入前と完全に同じ）。
 *
 * 規格化・積み上げ・軸の範囲のように「系列の全点から決まる計算」は、間引く前に全点で
 * 済ませておくこと。ここでは描く点だけを減らす。X の範囲が指定されているときは、見えて
 * いる範囲の点だけを対象にする（絞って拡大したときに、見えている部分の解像度を保つ）
 */
export function decimateSeriesPoints(
  points: Point[],
  type: "line" | "bar" | "scatter",
  range?: VisibleRange | null,
  max: number = CHART_MAX_DRAWN_POINTS
): Point[] {
  if (points.length <= max) return points;
  const clipped = clipToRange(points, range);
  if (clipped.length <= max) return clipped;
  return type === "line" ? decimateLinePoints(clipped, max) : decimateEvenPoints(clipped, max);
}

/** 系列ごとの指定（系列と同順）。type は系列が持つ描き方（無ければチャートの種類に従う） */
export type SeriesDecimateSpec = { range?: VisibleRange | null; type?: "line" | "bar" | "scatter" };

/**
 * 間引きが起きる系列があるか（図の下の知らせを出すかどうか）。
 * decimateSeriesPoints が実際に間引く条件と同じ（見えている範囲で上限を超える）
 */
export function needsDecimation(
  result: Extract<ChartDataResult, { kind: "ok" }>,
  chartType: ChartType,
  perSeries?: Array<SeriesDecimateSpec | undefined>,
  max: number = CHART_MAX_DRAWN_POINTS
): boolean {
  // 集計は全点で行う・カテゴリ軸はラベルと整列した配列: どちらも間引かない
  if (chartType === "histogram" || result.xAxis === "category") return false;
  return result.series.some((s, i) => {
    const points = s.points as Point[];
    return points.length > max && clipToRange(points, perSeries?.[i]?.range).length > max;
  });
}
