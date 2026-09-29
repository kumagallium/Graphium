// 本文枠（エディタ枠 [data-label-wrapper]）の中の余白を、枠の幅に応じて決める（純関数）。
//
// 余白の内訳（デスクトップの広い枠）:
//   枠の padding（左 24 / 右 24。ブロックラベルがあるときだけ右 80 = バッジ用の溝）
//   + .bn-editor の padding-inline 54px（ドラッグハンドル ⠿ と ＋ の分）
//   + タイトル・文脈タグの px-[54px]（本文と左端を揃える）。合計は最大 212px。
// この余白は枠の幅に関係なく固定なので、右パネルを開いて本文枠が 400px を切ると、
// 文字の幅が 200px 未満に痩せる（257px の枠では 45px。タイトルが 1 字ずつ縦に割れる）。
//
// 枠が狭いとき（NARROW_PANE_MAX_WIDTH 未満）だけ、本文の中の余白を詰める。
//   - 右の溝 80 → 24。ブロックラベルのバッジは compact 表示（1 文字）にして溝に収める
//   - .bn-editor とタイトル等の左 54 → 32。ハンドル（24px × 2 = 48px）は本文の左の余白
//     （枠の padding 24 + 32）へ張り出して収まる
//   - .bn-editor とタイトル等の右 54 → 24。右にはハンドルが無く、表の張り出し用の余白と
//     バッジの逃げ場だけあればよい
// 判定は枠の幅（ビューポートではない）。広い枠の値は今までと同じ。

/** この幅（px）未満の本文枠を「狭い」とみなす。枠は右パネル・サイドバーで縮む */
export const NARROW_PANE_MAX_WIDTH = 560;

/** .bn-editor の padding-inline の既定（BlockNote の値。ドラッグハンドルの溝） */
export const EDITOR_GUTTER_DEFAULT = 54;
/** 狭い枠の左の溝。ハンドル 48px が枠の padding（24）へ張り出して収まる最小 */
export const NARROW_GUTTER_LEFT = 32;
/** 狭い枠の右の溝。ハンドルが無いので、表の張り出しとバッジの逃げ場だけ */
export const NARROW_GUTTER_RIGHT = 24;

export type PaneSpacing = {
  /** 枠の padding（左） */
  padLeft: number;
  /** 枠の padding（右）。ブロックラベルがあるとき（広い枠のみ）80 */
  padRight: number;
  /** .bn-editor・タイトル・文脈タグの左右の溝 */
  gutterLeft: number;
  gutterRight: number;
};

/** 枠の幅（border box。スクロールバーを含める）が「狭い」か。測れていない（0）ときは偽 */
export function isNarrowPane(paneWidth: number): boolean {
  return Number.isFinite(paneWidth) && paneWidth > 0 && paneWidth < NARROW_PANE_MAX_WIDTH;
}

export function resolvePaneSpacing({
  isDesktop,
  hasLabels,
  narrow,
}: {
  isDesktop: boolean;
  /** ブロックラベルが 1 つでもあるか（ステップを繋いだ瞬間に幅が跳ねないよう、有無だけで決める） */
  hasLabels: boolean;
  narrow: boolean;
}): PaneSpacing {
  // モバイルは全幅で使う別の作り（ハンドルも無い）。狭い枠の詰めは対象外
  if (!isDesktop) {
    return {
      padLeft: 16,
      padRight: 16,
      gutterLeft: EDITOR_GUTTER_DEFAULT,
      gutterRight: EDITOR_GUTTER_DEFAULT,
    };
  }
  if (narrow) {
    return {
      padLeft: 24,
      padRight: 24,
      gutterLeft: NARROW_GUTTER_LEFT,
      gutterRight: NARROW_GUTTER_RIGHT,
    };
  }
  return {
    padLeft: 24,
    padRight: hasLabels ? 80 : 24,
    gutterLeft: EDITOR_GUTTER_DEFAULT,
    gutterRight: EDITOR_GUTTER_DEFAULT,
  };
}

/** 枠の中で文字に使える幅（余白を引いた残り）。中央カラムの上限は考えない */
export function paneTextWidth(paneWidth: number, s: PaneSpacing): number {
  return Math.max(0, paneWidth - s.padLeft - s.padRight - s.gutterLeft - s.gutterRight);
}

/** 狭い枠に note-app が付ける印（値は空）。来歴ラベルのバッジが置き方を切り替えるのに読む */
export const NARROW_PANE_ATTR = "data-narrow-pane";
