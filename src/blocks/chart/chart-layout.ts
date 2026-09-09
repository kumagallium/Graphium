// チャートブロックのサブプロット（複数 grid）レイアウト計算（純関数のみ）
//
// ECharts の grid.left/top/width/height は px 絶対値でしか渡せない。
// 「行×列に分割し、軸を共有する枠は隙間を詰めて隣の枠の軸ラベル領域を消す」という
// 割り付けロジックを ECharts から切り離しておくことで、DOM も無い環境で単体テストできる。
// 呼び出し側（view 側）はここで出た矩形をそのまま grid オプションに渡すだけにする。

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

/** 凡例 1 行の高さ(px)。ECharts の既定の行送りに合わせた実測値 */
export const LEGEND_LINE_HEIGHT = 17;

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
  measure?: (text: string) => number
): number {
  if (names.length === 0) return 0;
  // 縦並びは 1 項目 1 行
  if (orient === "vertical") return names.length;
  if (availableWidth <= 0) return 1;
  const textWidth = (text: string) => {
    const measured = measure?.(text) ?? 0;
    if (measured > 0) return measured;
    let w = 0;
    for (const ch of text) {
      // CJK・全角記号はおおむね正方形、それ以外は半角より少し広い程度
      w += ch.codePointAt(0)! > 0x2e80 ? fontSize : fontSize * 0.62;
    }
    return w;
  };
  // 記号の幅 + 記号と文字の間 + 項目どうしの間（ECharts の既定 itemGap = 10）
  const itemExtra = 50 + 5 + 10;
  let rows = 1;
  let used = 0;
  for (const name of names) {
    const w = textWidth(name) + itemExtra;
    if (used > 0 && used + w > availableWidth) {
      rows += 1;
      used = w;
    } else {
      used += w;
    }
  }
  return rows;
}
