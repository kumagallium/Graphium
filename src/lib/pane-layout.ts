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
//   - .bn-editor とタイトル等の左 54 → 56。ここは「詰める」でなく、見出しのハンドルを
//     枠の内側に収める最小値（下の NARROW_GUTTER_LEFT を参照）。広い枠は枠の padding 24 +
//     54 = 78 で見出しのハンドルが収まるが、狭い枠で 32 に詰めると見出しだけ切れた
//   - .bn-editor とタイトル等の右 54 → 12。右にはハンドルが無く、表の張り出し用の余白と
//     バッジの逃げ場だけあればよい（1 文字のバッジは幅 20px。右端から 8px 内側に置くので、
//     枠の padding 24 + 12 = 36 なら本文との隙間が 8px 残る）
// 判定は枠の幅（ビューポートではない）。広い枠の値は今までと同じ。
//
// 文字の幅の目安（offsetWidth 基準。スクロールバーを含む）: 枠 257px で 141px、408px で 292px。
// 当初の目標（150px / 300px 以上）は、見出しのハンドルを切らないことを優先して下げた。
// Windows の常時スクロールバー（約 15px）では、さらにその分だけ細くなる。

/** この幅（px）未満の本文枠を「狭い」とみなす。枠は右パネル・サイドバーで縮む */
export const NARROW_PANE_MAX_WIDTH = 560;

/** .bn-editor の padding-inline の既定（BlockNote の値。ドラッグハンドルの溝） */
export const EDITOR_GUTTER_DEFAULT = 54;
/** BlockNote の SideMenu（＋ と ⠿ が各 24px）の幅。ブロックの左端の左に、オフセット無しで付く */
export const SIDE_MENU_WIDTH = 48;
/** 見出しのハンドルを ▶ の分だけ左へ寄せる幅（app.css の `.bn-side-menu[data-block-type="heading"]` の translateX） */
export const HEADING_HANDLE_SHIFT = 28;
/** ハンドルが枠の左端（overflow の切れ目）から離れている最小の余白 */
const HANDLE_EDGE_MARGIN = 4;
/** 狭い枠の枠 padding（左）。resolvePaneSpacing の narrow と揃える */
const NARROW_PAD_LEFT = 24;
/**
 * 狭い枠の左の溝。見出しのハンドル（48 + 28 = 76px が本文の左端の左へ張り出す）が
 * 枠（[data-label-wrapper]。overflow-auto で、はみ出すと切れる）の内側に収まる最小。
 * 通常のブロックは 48px で済むが、見出しは ▶ の分だけさらに左へ寄る。32 だと見出しの ＋ が
 * ほぼ丸ごと切れた。ハンドルは .bn-container の中に描かれ、body へポータルされない。
 */
export const NARROW_GUTTER_LEFT =
  SIDE_MENU_WIDTH + HEADING_HANDLE_SHIFT + HANDLE_EDGE_MARGIN - NARROW_PAD_LEFT;
/** 狭い枠の右の溝。ハンドルが無いので、表の張り出しとバッジの逃げ場だけ */
export const NARROW_GUTTER_RIGHT = 12;

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
      padLeft: NARROW_PAD_LEFT,
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

/**
 * 用紙（A4 の幅で書く表示）の要素に付ける印（features/paper-mode の PaperFrame が用紙のときだけ付ける）。
 * 来歴ラベルのバッジ（prov-indicator）は、この印のある要素があれば本文枠の右端ではなく
 * 用紙の右端を基準に置き、右の溝（36px）に収まる 1 文字の形にする
 * （本文枠の右端基準だと、枠が用紙より広いときに用紙から離れ、狭いときに本文の文字へ重なる）。
 */
export const PAPER_SHEET_ATTR = "data-paper-sheet";
