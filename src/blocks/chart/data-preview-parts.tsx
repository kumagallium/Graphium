// データ素材の下見の見た目（線の形・列名）
//
// チャートのデータピッカーと素材一覧で共有する。中身の計算は data-preview.ts、
// 読み込みと溜め置きは data-preview-store.ts。

import type { ReactNode } from "react";
import { useT } from "../../i18n";
import type { DataPreview, SparkSeries } from "./data-preview";
import { CHART_SERIES_COLORS } from "./chart-theme";

/**
 * 線の形。x は全列共通の [xMin, xMax]、y は列ごとの [yMin, yMax] を枠（上下左右 2px 余白）に写す。
 * 線が無いとき（読み込み中・数値列なし）は空の枠だけを描く。
 */
export function Sparkline({
  series,
  width = 96,
  height = 28,
  className = "shrink-0 rounded bg-muted",
}: {
  series: SparkSeries[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const all = series.flatMap((s) => s.points);
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const xSpan = xMax - xMin;
  const lines = series.map((s, c) => {
    if (s.points.length < 2) return null;
    const ys = s.points.map((p) => p.y);
    const yMin = Math.min(...ys);
    const ySpan = Math.max(...ys) - yMin;
    const path = s.points
      .map((p) => {
        // x が全点同じなら中央に置く
        const x = xSpan === 0 ? width / 2 : ((p.x - xMin) / xSpan) * (width - 4) + 2;
        // 平らな線は中央に置く
        const y = ySpan === 0 ? height / 2 : height - 2 - ((p.y - yMin) / ySpan) * (height - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    return (
      <polyline
        key={c}
        points={path}
        fill="none"
        stroke={CHART_SERIES_COLORS[c]}
        strokeWidth={1.25}
        strokeLinejoin="round"
        // 枠を伸縮させても線の太さを保つ
        vectorEffect="non-scaling-stroke"
      />
    );
  });
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // CSS で枠を伸ばしたとき（ギャラリーのカード）に縦横それぞれ追従させる
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {lines}
    </svg>
  );
}

/**
 * 列名を ", " で並べ、長ければ途中で … で切る。線にした列は線と同じ色の文字にする。
 * 表示しきれなかった列があれば末尾に「ほか N 列」を付ける。
 */
export function ColumnNames({
  headers,
  lined,
  moreLabel,
  max = 40,
}: {
  headers: string[];
  /** 線にした列名（先頭から線の色の順） */
  lined: string[];
  moreLabel: (count: number) => string;
  max?: number;
}) {
  const names = headers.filter((h) => h.trim() !== "");
  const parts: ReactNode[] = [];
  let used = 0;
  let shown = 0;
  for (let i = 0; i < names.length; i++) {
    const sep = i === 0 ? "" : ", ";
    const room = max - used - sep.length;
    if (room <= 0) break;
    const name = names[i];
    const cut = name.length > room;
    const c = lined.indexOf(name);
    parts.push(
      <span key={i}>
        {sep}
        <span style={c >= 0 ? { color: CHART_SERIES_COLORS[c] } : undefined}>
          {cut ? `${name.slice(0, room)}…` : name}
        </span>
      </span>
    );
    used += sep.length + (cut ? room : name.length);
    shown = i + 1;
    if (cut) {
      break;
    }
  }
  const rest = names.length - shown;
  return (
    <>
      {parts}
      {rest > 0 && ` ${moreLabel(rest)}`}
    </>
  );
}

/** 翻訳文の {names} に入れる目印（差し込み位置を割り出すため） */
const NAMES_MARK = "\u0001";

/** 「列: A, B, C · 1,234 行」の 1 行（線にした列は線と同じ色） */
export function DataSummary({ preview }: { preview: DataPreview }) {
  const t = useT();
  // 翻訳文の {names} の位置に、色付きの列名を差し込む
  const [before, after = ""] = t("chart.pickerColumns", { names: NAMES_MARK }).split(NAMES_MARK);
  return (
    <>
      {before}
      <ColumnNames
        headers={preview.headers}
        lined={preview.sparkline.map((s) => s.column)}
        moreLabel={(count) => t("chart.pickerMoreColumns", { count: String(count) })}
      />
      {after}
      {" · "}
      {t("chart.pickerRows", { count: preview.rowCount.toLocaleString() })}
    </>
  );
}
