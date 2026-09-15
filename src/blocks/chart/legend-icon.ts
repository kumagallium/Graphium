// 散布図系列の凡例（横並びで項目どうしが詰まって見える問題への対処）
//
// ECharts の既定では、散布図系列の凡例アイコンはマーカー（例: circle）を
// 記号枠（CHART_LEGEND_ITEM = 50×14）の中央に縦横比を保って描く。墨があるのは
// 枠の x=18..32 だけで、左右に 18px ずつ空きができる。凡例を横に並べるとき
// ECharts は項目の bbox（墨の範囲）どうしを itemGap だけ離して置くので、
//   - 前の項目のラベル → 次のマーカー: itemGap（8〜10px）
//   - マーカー → 自分のラベル: 右の空き 18px + 5px = 23px
// となり、マーカーが前の項目に属して見える（"● S● zT"）。折れ線（線が枠を埋める）
// と棒（roundRect が枠を埋める）はマーカーとラベルが離れないので起きない。
// 縦並びは 1 項目 1 行なので前の項目と並ばず、問題にならない。
//
// 対処（横並びのときだけ）:
//   - 全項目が散布図: 記号枠を正方形（itemWidth = itemHeight）に詰める。
//     マーカーが自分のラベルの 5px 手前に来る
//   - 折れ線・棒と混在: 記号枠は 50 のまま（詰めると折れ線のアイコンが潰れる）、
//     散布図の項目だけマーカーを枠の右端に置いた path アイコンを渡す。
//     左端にも描かない点（moveTo だけ）を置いて bbox を 0..50 に広げるので、
//     項目の幅は折れ線と同じく「記号 50 + 5 + ラベル」になる
// どちらも estimateLegendRows に渡す記号枠の幅と一致する。
import type { SeriesSymbolShape } from "./chart-config";
import { CHART_LEGEND_ITEM } from "./chart-theme";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * 記号枠の右端に寄せた散布図マーカーの凡例アイコン（ECharts の legend.data[].icon）。
 *
 * マーカーの寸法は ECharts の既定と同じ（枠の高さを一辺とする正方形に内接）。
 * 白抜き（empty*）は "emptypath://" にすると、既定の白抜きマーカーと同じく
 * 白塗り + 系列色の線で描かれる。
 */
export function scatterLegendIcon(
  symbol: SeriesSymbolShape,
  width: number = CHART_LEGEND_ITEM.width,
  height: number = CHART_LEGEND_ITEM.height
): string {
  const empty = symbol.startsWith("empty");
  const shape = (empty ? symbol.slice(5) : symbol).toLowerCase();
  const x0 = fmt(width - height);
  const x1 = fmt(width);
  const cx = fmt(width - height / 2);
  const cy = fmt(height / 2);
  const h = fmt(height);
  const r = fmt(height / 2);

  let body: string;
  switch (shape) {
    case "rect":
      body = `M${x0} 0L${x1} 0L${x1} ${h}L${x0} ${h}Z`;
      break;
    case "triangle":
      body = `M${cx} 0L${x1} ${h}L${x0} ${h}Z`;
      break;
    case "diamond":
      body = `M${cx} 0L${x1} ${cy}L${cx} ${h}L${x0} ${cy}Z`;
      break;
    default:
      // circle
      body = `M${x0} ${cy}A${r} ${r} 0 1 1 ${x1} ${cy}A${r} ${r} 0 1 1 ${x0} ${cy}Z`;
  }
  // 枠の左端に描かない点を置き、アイコンの bbox を枠いっぱいに広げる
  return `${empty ? "empty" : ""}path://M0 ${cy}${body}`;
}

export type LegendItemSeries = {
  name: string;
  /** 散布図系列ならそのマーカーの形。折れ線・棒などは null */
  scatterSymbol: SeriesSymbolShape | null;
};

/**
 * 1 つの凡例の data と記号枠の幅を決める。
 * 縦並び・散布図を含まない凡例は従来どおり（名前だけ・枠 50）。
 */
export function legendItems(
  entries: LegendItemSeries[],
  orient: "horizontal" | "vertical"
): { data: Array<string | { name: string; icon: string }>; itemWidth: number } {
  const names = entries.map((e) => e.name);
  const anyScatter = entries.some((e) => e.scatterSymbol !== null);
  if (orient !== "horizontal" || !anyScatter) {
    return { data: names, itemWidth: CHART_LEGEND_ITEM.width };
  }
  if (entries.every((e) => e.scatterSymbol !== null)) {
    return { data: names, itemWidth: CHART_LEGEND_ITEM.height };
  }
  return {
    data: entries.map((e) =>
      e.scatterSymbol !== null ? { name: e.name, icon: scatterLegendIcon(e.scatterSymbol) } : e.name
    ),
    itemWidth: CHART_LEGEND_ITEM.width,
  };
}
