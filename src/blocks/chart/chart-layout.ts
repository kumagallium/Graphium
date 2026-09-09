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
