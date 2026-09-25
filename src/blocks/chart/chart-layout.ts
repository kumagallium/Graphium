// チャートブロックのレイアウト計算（純関数のみ）
//
// ECharts の grid.left/top/width/height は px 絶対値でしか渡せない。
// 「行×列に分割し、軸を共有する枠は隙間を詰めて隣の枠の軸ラベル領域を消す」という
// 割り付けロジックを ECharts から切り離しておくことで、DOM も無い環境で単体テストできる。
// 呼び出し側（view 側）はここで出た矩形をそのまま grid オプションに渡すだけにする。
// 図の外周余白・図の高さ・目盛りの本数（狭い場所の図を読めるようにする計算）もここに置く。

import { CHART_LEGEND_ITEM } from "./chart-theme";

/** 枠と枠の間の最小余白(px)。軸を共有しない場合、軸ラベル領域に加えて空ける */
export const PANEL_GAP = 16;

export type PanelLayoutInput = {
  /** 縦分割数（1 以上） */
  rows: number;
  /** 横分割数（1 以上） */
  cols: number;
  /** チャート要素の幅(px) */
  width: number;
  /** チャート要素の高さ(px) */
  height: number;
  /** 図全体の外周余白(px)。凡例・軸名の有無から呼び出し側が決める */
  outer: { left: number; right: number; top: number; bottom: number };
  /** 枠が自分の X 軸の目盛りラベル・軸名を出すときに要る高さ(px) */
  xAxisSpace: number;
  /** 枠が自分の Y 軸の目盛りラベル・軸名を出すときに要る幅(px) */
  yAxisSpace: number;
  /** 縦に並ぶ枠をつなげる（X 軸を共有し、枠間の余白を 0 にする） */
  joinVertical: boolean;
  /** 横に並ぶ枠をつなげる（Y 軸を共有し、枠間の余白を 0 にする） */
  joinHorizontal: boolean;
};

export type PanelLayout = {
  /** 枠の矩形(px)。行優先（左上が index 0） */
  grids: Array<{ left: number; top: number; width: number; height: number }>;
  /** 枠ごとに自分の X 軸の目盛り・軸名を出すか */
  showXAxis: boolean[];
  /** 枠ごとに自分の Y 軸の目盛り・軸名を出すか */
  showYAxis: boolean[];
};

/**
 * 行数・列数を正規化する。0 以下・非整数・NaN が来ても必ず 1 以上の整数にする
 * （テーブル設定の未入力・保存済み設定の壊れを描画エラーに直結させないため）
 */
function normalizeCount(n: number): number {
  return Math.max(1, Math.floor(n));
}

export function computePanelLayout(input: PanelLayoutInput): PanelLayout {
  const rows = normalizeCount(input.rows);
  const cols = normalizeCount(input.cols);
  const { width, height, outer, xAxisSpace, yAxisSpace, joinVertical, joinHorizontal } = input;

  const colGap = joinHorizontal ? 0 : yAxisSpace + PANEL_GAP;
  const rowGap = joinVertical ? 0 : xAxisSpace + PANEL_GAP;

  // 幅・高さがマイナスに落ちても呼び出し側（ECharts）に負値を渡さない。
  // 潰れた枠を 0 として描かせ、例外にはしない
  const availableWidth = width - outer.left - outer.right;
  const availableHeight = height - outer.top - outer.bottom;
  const panelWidth = Math.max(0, (availableWidth - (cols - 1) * colGap) / cols);
  const panelHeight = Math.max(0, (availableHeight - (rows - 1) * rowGap) / rows);

  const grids: PanelLayout["grids"] = [];
  const showXAxis: boolean[] = [];
  const showYAxis: boolean[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      grids.push({
        left: outer.left + col * (panelWidth + colGap),
        top: outer.top + row * (panelHeight + rowGap),
        width: panelWidth,
        height: panelHeight,
      });
      showXAxis.push(joinVertical ? row === rows - 1 : true);
      showYAxis.push(joinHorizontal ? col === 0 : true);
    }
  }

  return { grids, showXAxis, showYAxis };
}

/**
 * 凡例が折り返したときの行送り(px)。ECharts は項目の高さ（記号枠 14）+
 * 項目間の余白（itemGap 10）で次の行へ送る（2026-09-25 実測。上に置いても下に
 * 置いても 24px）。折り返した行数ぶんをこれで空ける。以前の通常の図は 1 行 17px で
 * 空けていたので、4 行で凡例が枠に接し、5 行以上で最終行が枠に食い込んでいた
 */
export const LEGEND_ROW_PITCH = 24;

// ── 狭い場所（サイドピーク等）の図 ────────────────────────────────
// 余白は 16px の文字に合わせた固定値なので、幅が 400px を切ると描画領域のほうが
// 先に潰れる（幅 224px の図で 108×46px、175px で 59×12px まで縮んだ）。
// 狭い図だけ余白を詰め、描画領域に最低限の高さを確保する。幅が足りる図は
// 従来とまったく同じ値になる（既存ノートの図は動かない）

/** これより狭い図はコンパクトに描く(px) */
export const COMPACT_CHART_WIDTH = 400;

/** コンパクトな図で、枠 1 段に確保する描画領域の高さ(px) */
export const MIN_COMPACT_PANEL_HEIGHT = 120;

export function isCompactChart(width: number): boolean {
  return width > 0 && width < COMPACT_CHART_WIDTH;
}

export type FigureMarginsInput = {
  compact: boolean;
  /** どれかの枠が縦軸名を持つ（共有した縦軸名を含む） */
  anyYName: boolean;
  /** どれかの枠が横軸名を持つ */
  anyXName: boolean;
  /** どれかの枠が第 2 軸を使う */
  anyUseRight: boolean;
  /** どれかの枠の第 2 軸が名前を持つ */
  anyYRightName: boolean;
  /** 図全体の凡例を枠の上に置く */
  legendTop: boolean;
  /** 図全体の凡例を枠の下に置く */
  legendBottom: boolean;
  /** 凡例の行数（折り返さなければ 1） */
  legendRows: number;
  /**
   * 縦軸（左）の目盛りラベルの最大幅(px)。コンパクトな図だけが使う
   *（valueAxisTickLabels の候補を測った値）。通常の図は固定の余白のまま
   */
  yLabelWidth?: number;
  /** 第 2 軸の目盛りラベルの最大幅(px)。同上 */
  yRightLabelWidth?: number;
};

export type FigureMargins = {
  /** 図の外周余白(px)。プロット領域の上下左右 */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** 枠が自分の X 軸の目盛りラベル・軸名を出すのに要る高さ(px)。分割時の枠の間隔に使う */
  xAxisSpace: number;
  /** 縦軸の軸線から軸名までの間隔(px)。ECharts の nameGap */
  yNameGap: number;
  /** 第 2 軸の軸線から軸名までの間隔(px) */
  yRightNameGap: number;
  /** 横軸の軸線から軸名までの間隔(px) */
  xNameGap: number;
};

// ECharts が目盛りラベルを置く位置（軸線から axisLabel.margin の既定 8px 外）と、
// 縦書きになる軸名 1 行ぶんの幅（16px の文字の行ボックス）
const AXIS_LABEL_MARGIN = 8;
const AXIS_NAME_LINE = 20;
// ラベルと軸名の間（ECharts 6 が枠の広い図で軸名の周りに取る余白と同じ 8px）と、
// 軸名と図の端の間に残す隙間
const AXIS_NAME_PAD = 8;
const FIGURE_EDGE_PAD = 4;

/**
 * 図の外周余白と軸名の間隔。
 *
 * 通常の値は 16px の文字・内向きの目盛りに合わせた固定値（ラベル 5 文字程度まで
 * 収まる）。コンパクトでは、縦軸名を「実際の目盛りラベルのすぐ外」に置き、左右の
 * 余白をその分だけにする。固定値のまま詰めると、長めのラベル（"24.5"）で ECharts が
 * 軸名をラベルの外へ逃がし、図からはみ出した枠だけを縮めるので、分割した図の枠が
 * 揃わなくなる（実際に下の枠だけ 12px ずれた）。呼び出し側は縦軸に
 * nameMoveOverlap: false を渡し、ここで決めた nameGap をそのまま使わせる
 */
export function computeFigureMargins(input: FigureMarginsInput): FigureMargins {
  const { compact, anyYName, anyXName, anyUseRight, anyYRightName, legendTop, legendBottom } = input;
  const extraRows = Math.max(0, Math.floor(input.legendRows) - 1);
  // 折り返した行のぶん（1 行なら 0 なので、凡例が 1 行の図の余白は変わらない）
  const extraLegend = extraRows * LEGEND_ROW_PITCH;
  if (!compact) {
    const xAxisSpace = anyXName ? 64 : 40;
    return {
      left: anyYName ? 84 : 60,
      right: anyUseRight ? (anyYRightName ? 84 : 60) : 32,
      top: legendTop ? 48 + extraLegend : 20,
      bottom: xAxisSpace + (legendBottom ? 32 + extraLegend : 0),
      xAxisSpace,
      yNameGap: 52,
      yRightNameGap: 52,
      xNameGap: 34,
    };
  }
  const xAxisSpace = anyXName ? 56 : 32;
  // 軸線 → ラベル → 軸名 → 図の端、の順に積む
  const nameGapFor = (labelWidth: number) => Math.ceil(AXIS_LABEL_MARGIN + labelWidth + AXIS_NAME_PAD);
  const sideFor = (labelWidth: number, named: boolean) =>
    named
      ? nameGapFor(labelWidth) + AXIS_NAME_LINE + FIGURE_EDGE_PAD
      : Math.ceil(AXIS_LABEL_MARGIN + labelWidth + FIGURE_EDGE_PAD);
  const yLabelWidth = Math.max(0, input.yLabelWidth ?? 0);
  const yRightLabelWidth = Math.max(0, input.yRightLabelWidth ?? 0);
  return {
    left: sideFor(yLabelWidth, anyYName),
    // 第 2 軸が無ければ、X 軸の最後のラベル（右端の目盛りに中央揃え）の半分が出るだけ
    right: anyUseRight ? sideFor(yRightLabelWidth, anyYRightName) : 16,
    top: legendTop ? 38 + extraLegend : 16,
    bottom: xAxisSpace + (legendBottom ? 28 + extraLegend : 0),
    xAxisSpace,
    yNameGap: nameGapFor(yLabelWidth),
    yRightNameGap: nameGapFor(yRightLabelWidth),
    xNameGap: 30,
  };
}

/**
 * ECharts の「きりのよい刻み」（range ÷ 分割数を 1・2・3・5・10 × 10^n に丸める。
 * echarts/lib/util/number.js の nice(val, round) と同じ規則）
 */
function niceInterval(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exponent = Math.floor(Math.log10(raw));
  const exp10 = 10 ** exponent;
  const f = raw / exp10;
  const nf = f < 1.5 ? 1 : f < 2.5 ? 2 : f < 4 ? 3 : f < 7 ? 5 : 10;
  const value = nf * exp10;
  return exponent < 0 ? Number(value.toFixed(-exponent)) : value;
}

/** 小数点以下の桁数（1e-7 のような指数表記も数える） */
function decimalsOf(value: number): number {
  const text = String(value);
  const exp = text.match(/e-(\d+)$/);
  if (exp) return Number(exp[1]) + (text.split("e")[0].split(".")[1]?.length ?? 0);
  return text.split(".")[1]?.length ?? 0;
}

/** ECharts の数値軸ラベルと同じ書式（必要な小数だけ・整数部は 3 桁区切り） */
function formatTickValue(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(Math.min(20, Math.max(0, decimals))));
  const [int, frac] = String(rounded).split(".");
  return int.replace(/(\d{1,3})(?=(?:\d{3})+(?!\d))/g, "$1,") + (frac !== undefined ? `.${frac}` : "");
}

/**
 * 数値軸の目盛りラベル（の見積もり）。
 *
 * ECharts の刻みの決め方（範囲 ÷ 分割数をきりのよい刻みに丸め、明示されていない端は
 * その刻みの倍数まで広げる）をなぞり、並ぶラベルを ECharts と同じ書式で返す
 *（"24" と "26" の間に "24.5" が出るので、端だけでなく全部を見る）。明示された端
 *（最小値・最大値の指定）は、その値自身の桁数でそのままラベルになる。
 * 狭い図で縦軸の余白を「ラベルが収まるぶん」に詰めるための見積もり
 */
export function valueAxisTickLabels(
  extent: { min: number; max: number },
  splitNumber: number,
  fixed: { min: boolean; max: boolean } = { min: false, max: false }
): string[] {
  let { min, max } = extent;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max < min) [min, max] = [max, min];
  // 幅 0 の範囲は ECharts と同じく値の半分ずつ上下に広げる（0 なら 0〜1）
  if (max === min) {
    if (min === 0) max = 1;
    else {
      const half = Math.abs(min) / 2;
      if (!fixed.min) min -= half;
      if (!fixed.max) max += half;
    }
  }
  const interval = niceInterval((max - min) / Math.max(1, Math.floor(splitNumber)));
  const decimals = decimalsOf(interval);
  const lo = fixed.min ? min : Math.floor(min / interval) * interval;
  const hi = fixed.max ? max : Math.ceil(max / interval) * interval;
  const labels = new Set<string>();
  if (fixed.min) labels.add(formatTickValue(lo, decimalsOf(lo)));
  if (fixed.max) labels.add(formatTickValue(hi, decimalsOf(hi)));
  // 刻みの数は分割数の 2 倍程度に収まる。浮動小数の誤差で端の刻みを落とさないよう
  // 少しだけ内側に丸める
  const first = Math.ceil(lo / interval - 1e-9);
  const last = Math.floor(hi / interval + 1e-9);
  for (let k = first; k <= last && k - first < 50; k++) {
    labels.add(formatTickValue(k * interval, decimals));
  }
  return [...labels];
}

/**
 * 文字幅の近似(px)。実測（canvas）が使えない環境（テストの jsdom）の代わり。
 * CJK・全角記号はおおむね正方形、それ以外は半角より少し広い程度
 */
export function approxTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) {
    w += ch.codePointAt(0)! > 0x2e80 ? fontSize : fontSize * 0.62;
  }
  return w;
}

export type FigureHeightInput = {
  /** 図の幅(px) */
  width: number;
  /** アスペクト比（幅 ÷ 高さ） */
  aspectRatio: number;
  compact: boolean;
  /** 縦に並ぶ枠の数（分割なしは 1） */
  rows: number;
  margins: Pick<FigureMargins, "top" | "bottom" | "xAxisSpace">;
  /** 縦に並ぶ枠をつなげる（枠の間隔 0） */
  joinVertical: boolean;
};

/**
 * 図の高さ(px)。基本は「幅 ÷ アスペクト比」。
 *
 * コンパクトな図は、余白を引いた残りが枠 1 段あたり MIN_COMPACT_PANEL_HEIGHT に
 * 届くまで縦に伸ばす。狭い場所ではアスペクト比より「目盛りが読める」ことを
 * 優先する（比を守ると 5:1 の図は幅 224px で高さ 45px になり、何も読めない）
 */
export function computeFigureHeight(input: FigureHeightInput): number {
  const byAspect = Math.round(input.width / input.aspectRatio);
  if (!input.compact) return byAspect;
  const rows = normalizeCount(input.rows);
  const rowGap = input.joinVertical ? 0 : input.margins.xAxisSpace + PANEL_GAP;
  const needed =
    input.margins.top + input.margins.bottom + (rows - 1) * rowGap + rows * MIN_COMPACT_PANEL_HEIGHT;
  return Math.max(byAspect, Math.ceil(needed));
}

/** ECharts の数値軸・時間軸の既定の分割数 */
const DEFAULT_SPLIT_NUMBER = 5;

/**
 * 数値軸・時間軸の分割数（ECharts の splitNumber）。
 *
 * ECharts の既定（5）は軸の長さを見ないので、短い軸では目盛りラベルが重なる
 *（高さ 46px の縦軸に 4.0〜7.5 の 8 本が並んだ）。1 目盛りあたり minPitch(px) を
 * 確保できる数まで減らす。既定の 5 のままで収まる長さなら undefined を返す —
 * option に何も足さないので、十分な大きさの図は従来のまま描かれる。
 * 下限は 2。1 分割だと刻みが大きく丸められ、軸の範囲がデータより大きく広がる
 *（0〜60 のデータが 0〜100 の軸になる）。それでも収まらないラベルは hideOverlap に任せる
 */
export function axisSplitNumber(lengthPx: number, minPitchPx: number): number | undefined {
  if (!(lengthPx > 0) || !(minPitchPx > 0)) return undefined;
  const fits = Math.floor(lengthPx / minPitchPx);
  return fits >= DEFAULT_SPLIT_NUMBER ? undefined : Math.max(2, fits);
}

/**
 * 凡例が何行になるかの見積もり。
 *
 * ECharts は凡例を描いてから折り返すが、こちらは描く前にプロット領域の
 * 上端（または下端）を決めないといけないので、文字幅を見積もって先回りする。
 * 行数を読み違えると、折り返した 2 行目がプロット枠に重なる（系列が 4 本を
 * 超えると実際に起きる）。
 *
 * 幅は measure（呼び出し側が渡す実測）を使う。実測できない環境（テストの jsdom）
 * では「全角は 1em、それ以外は 0.62em」の近似に落ちる。近似だけに頼ると 15% ほど
 * 短く出て、実際には折り返しているのに 1 行と判定して枠に重なった。
 */
export function estimateLegendRows(
  names: string[],
  availableWidth: number,
  orient: "horizontal" | "vertical",
  fontSize: number,
  /** 実測の文字幅(px)。測れないときは 0 以下を返す */
  measure?: (text: string) => number,
  /** 記号枠の幅(px)。散布図だけの横並び凡例は詰める（legend-icon.ts の legendItems） */
  itemWidth: number = CHART_LEGEND_ITEM.width
): number {
  if (names.length === 0) return 0;
  // 縦並びは 1 項目 1 行
  if (orient === "vertical") return names.length;
  if (availableWidth <= 0) return 1;
  const textWidth = (text: string) => {
    const measured = measure?.(text) ?? 0;
    return measured > 0 ? measured : approxTextWidth(text, fontSize);
  };
  // 1 項目の幅 = 記号 + 記号と文字の間（5）+ 文字。項目どうしの間（ECharts の既定
  // itemGap = 10）は項目の後ろに空くが、折り返すかどうかは「行の中の位置 + 項目の幅」
  // が凡例の幅を超えるかで決まる（ECharts の util/layout.js の boxLayout と同じ規則）。
  // 行末の項目にまで間を足すと、ほぼ埋まった行を 1 行多く見積もり、凡例と枠の間が
  // 1 行ぶん空く（8 系列の図で、見積もり 7 行・実際は 5 行だった）
  const itemExtra = itemWidth + 5;
  const itemGap = 10;
  let rows = 1;
  let used = 0;
  for (const name of names) {
    const w = textWidth(name) + itemExtra;
    if (used > 0 && used + w > availableWidth) {
      rows += 1;
      used = w + itemGap;
    } else {
      used += w + itemGap;
    }
  }
  return rows;
}
