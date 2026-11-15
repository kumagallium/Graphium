// チャートのツールチップ（ECharts は formatter の返す文字列を innerHTML に入れる）。
//
// 系列名・軸の値・単位は取り込んだノート由来（表の列見出し等）で、利用者が書いたとは
// 限らない。HTML として差し込む値は必ず escapeHtml を通す。marker と <br/> は固定文字列。

import type { getLocale } from "../../i18n";
import { escapeHtml } from "../../lib/escape-html";
import { unstackValue, type ChartSeriesData, type XAxisKind } from "./chart-data";
import { formatFullDateTime } from "./time-axis-format";

/** ツールチップの丸印に使う既定色 */
const FALLBACK_MARKER_COLOR = "#888888";

/**
 * 丸印の style に差し込んでよい色だけ通す（#hex / rgb() / hsl() / 色名）。
 * 色は取り込んだノート由来の任意文字列で、`;` を含めると CSS 宣言を足せるため、
 * escapeHtml では防げない。通らなければ既定色に落とす。
 */
export function safeMarkerColor(color: unknown): string {
  if (typeof color !== "string") return FALLBACK_MARKER_COLOR;
  const c = color.trim();
  if (
    /^#[0-9a-f]{3,8}$/i.test(c) ||
    /^(rgb|hsl)a?\(\s*[0-9.,%\s/deg-]+\)$/i.test(c) ||
    /^[a-z]{3,30}$/i.test(c)
  ) {
    return c;
  }
  return FALLBACK_MARKER_COLOR;
}

/** ツールチップの丸印（色は safeMarkerColor を通す。ECharts の p.marker は色をそのまま差すので使わない） */
function markerHtml(color: unknown): string {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${safeMarkerColor(color)};margin-right:4px"></span>`;
}

/**
 * スタック時のツールチップ。
 *
 * 描画上の y は規格化 + 段オフセット後の値なので、そのまま出すと
 * 「2 段目の 1.45」のような読めない数字になる。各系列に残した
 * offset / scale から元の測定値へ戻して出す。
 */
/**
 * 枠をまたいだツールチップ。
 *
 * 枠をつなぐと十字カーソルが全枠を貫くが、ECharts のツールチップは grid ごとに
 * 開くので、そのままだと同じ x の箱が枠の数だけ重なる。先頭の枠のぶんだけを
 * 本文つきにし（他は空文字を返して消す）、そこに全枠の値を並べる。
 * 「同じ 2θ で各段がいくつか」を 1 か所で読める形にするのが、枠を分けて
 * 並べる目的そのものなので、値を集めるのはこの形が素直。
 */
export function crossPanelTooltipFormatter(
  locale: ReturnType<typeof getLocale>,
  xKind: XAxisKind,
  rows: Array<{
    column: number;
    name: string;
    color: string;
    points: Array<[number, number]>;
    source: ChartSeriesData;
  }>,
  reporterColumnOf: Map<number, number>
) {
  // その x に最も近い点の値。段ごとに測定間隔が違っても隣の点を拾えるようにする
  const valueAt = (points: Array<[number, number]>, x: number): number | null => {
    let best: number | null = null;
    let bestGap = Infinity;
    for (const [px, py] of points) {
      const gap = Math.abs(px - x);
      if (gap < bestGap) {
        bestGap = gap;
        best = py;
      }
    }
    return best;
  };
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    // 本文を出すのは、その列の最上段の枠に属する係だけ。
    // 下の段のぶんは空文字を返して箱ごと消す（同じ内容が段の数だけ開くため）
    const reporter = list.find((p: any) => reporterColumnOf.has(p.seriesIndex));
    if (!reporter) return "";
    const column = reporterColumnOf.get(reporter.seriesIndex)!;
    const first = list[0];
    const x = Number(Array.isArray(first.value) ? first.value[0] : first.axisValue);
    const head = xKind === "time" ? formatFullDateTime(x, locale) : escapeHtml(first.axisValue ?? x);
    const body = rows.filter((row) => row.column === column).map((row) => {
      const drawn = valueAt(row.points, x);
      if (drawn === null) return "";
      const raw = unstackValue(drawn, row.source);
      const marker = markerHtml(row.color);
      return `${marker}${escapeHtml(row.name)}: ${Number.isFinite(raw) ? raw : ""}`;
    });
    return [head, ...body.filter(Boolean)].join("<br/>");
  };
}

export function stackTooltipFormatter(
  locale: ReturnType<typeof getLocale>,
  xKind: XAxisKind,
  series: Array<ChartSeriesData | null>
) {
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    const first = list[0];
    const x = Array.isArray(first.value) ? first.value[0] : first.axisValue;
    const head = xKind === "time" ? formatFullDateTime(Number(x), locale) : escapeHtml(x);
    // 段の土台は値を持たない飾りなので行にしない
    const rows = list
      .filter((p: any) => series[p.seriesIndex])
      .map((p: any) => {
      const drawn = Number(Array.isArray(p.value) ? p.value[1] : p.value);
      const raw = unstackValue(drawn, series[p.seriesIndex] ?? undefined);
      return `${markerHtml(p.color)}${escapeHtml(p.seriesName)}: ${Number.isFinite(raw) ? raw : ""}`;
    });
    return [head, ...rows].join("<br/>");
  };
}

/** 時間軸のツールチップ: 見出しに完全な日時、各行に系列名と値 */
export function timeTooltipFormatter(locale: ReturnType<typeof getLocale>) {
  return (params: any) => {
    const list = Array.isArray(params) ? params : [params];
    if (list.length === 0) return "";
    const first = list[0];
    const x = Array.isArray(first.value) ? first.value[0] : first.axisValue;
    const head = formatFullDateTime(Number(x), locale);
    const rows = list.map((p: any) => {
      const y = Array.isArray(p.value) ? p.value[1] : p.value;
      return `${markerHtml(p.color)}${escapeHtml(p.seriesName)}: ${escapeHtml(y)}`;
    });
    return [head, ...rows].join("<br/>");
  };
}
