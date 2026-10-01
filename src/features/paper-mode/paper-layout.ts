// A4 の用紙の幅で書く表示 — 用紙の寸法と「紙の見た目にできる広さか」の判定
//
// 数字は印刷（src/app.css の `#graphium-print-root[data-paper="a4"] { width: 170mm }`。
// A4 の紙で左右 20mm）と揃えてある。画面で見る幅と印刷の折り返しを一致させるのが目的なので、
// ここを動かすときは印刷側も同時に見ること。標準のノートの印刷は 180mm のまま。

export type PaperMode = "standard" | "a4";

/**
 * 実際に描く見た目。
 * - sheet: 机の上に用紙を置く（A4 かつ枠が十分に広い）
 * - flow: 今と同じ流れる本文（standard、または A4 だが枠が用紙より狭い）
 */
export type PaperLayout = "flow" | "sheet";

/** CSS の 1mm は 96/25.4 px */
const PX_PER_MM = 96 / 25.4;

/**
 * 用紙の幅（A4 = 210mm。96dpi で約 793.7px）。CSS は `210mm` で描くので、丸めずに mm から出す
 * （丸めると本文の幅が印刷の 170mm とずれて、境目の行が違う所で折り返す）。
 */
export const PAPER_WIDTH_PX = 210 * PX_PER_MM;

/** 用紙の上下の余白（15mm。約 56.7px）。印刷の @page の余白と同じ */
export const PAPER_MARGIN_PX = 15 * PX_PER_MM;

/**
 * 印刷の 1 ページの本文の高さ（A4 縦 297mm - 余白 15mm × 2 = 267mm。約 1009px）。
 * 印刷の改ページ回避の判定（pdf-export/print-note.ts の fitContentToPage）と、
 * 画面の改ページの目安の線（page-breaks.ts）が同じ値を使う。
 */
export const PRINT_PAGE_CONTENT_HEIGHT_PX = (297 - 15 * 2) * PX_PER_MM;

/** 用紙の罫線（1px）。border-box なので用紙の内寸は幅から左右の罫線を引いた値になる */
export const PAPER_BORDER_PX = 1;

/** 印字の幅（170mm = 用紙 - 左右の余白 20mm。約 642.5px）。印刷の折り返しと揃える幅 */
export const PAPER_TEXT_WIDTH_PX = 170 * PX_PER_MM;

/** ドラッグハンドル（⠿ と ＋）の幅 */
export const SIDE_HANDLE_WIDTH_PX = 48;

/**
 * 見出しのハンドルを外へ寄せる量（src/app.css の
 * `.bn-side-menu[data-block-type="heading"] { transform: translateX(-28px) }`。
 * 見出しの折りたたみ ▶ とハンドルが同じ場所を取り合わないための寄せ）。
 * 用紙の中でもこの寄せは効く。
 */
export const HEADING_HANDLE_SHIFT_PX = 28;

/**
 * 見出しのハンドルを外へ寄せる量を、用紙の中だけ詰めた値（src/features/paper-mode/paper-frame.css の
 * `[data-paper-layout="sheet"] .bn-side-menu[data-block-type="heading"]`）。
 * ▶ の幅（26px。app.css の .gph-heading-toggle）と同じで、ハンドルと ▶ は重ならない。
 * 左右 20mm の対称にすると溝が約 74.6px で、標準の寄せ（28px）ではハンドルが 1.4px
 * 用紙の外へ出るため、用紙の中だけ 2px 詰めて収める。
 */
export const PAPER_HEADING_HANDLE_SHIFT_PX = 26;

/**
 * 用紙の左右の溝（等しい）。用紙の内寸（210mm - 罫線）から印字の幅（170mm）を引いた半分で、
 * 約 74.6px（20mm = 約 75.6px から罫線 1px ぶん）。見出しのハンドル（48 + 26 = 74px）も
 * 用紙の内側に収まる。
 */
export const PAPER_GUTTER_PX = (PAPER_WIDTH_PX - PAPER_BORDER_PX * 2 - PAPER_TEXT_WIDTH_PX) / 2;

export const PAPER_GUTTER_LEFT_PX = PAPER_GUTTER_PX;
export const PAPER_GUTTER_RIGHT_PX = PAPER_GUTTER_PX;

/**
 * 用紙の左右に最低限残す机の余白（px）。これを取れない枠では紙の見た目をやめる。
 * 12px に詰めてあるのは、Windows 150%（1280 幅）で右パネルを開いたまま 80% に縮小した
 * 本文枠（824px）でも用紙で出すため（用紙 794 + 12 * 2 = 818px から）。
 */
export const DESK_MARGIN_PX = 12;
// 判定は縦スクロールバーを含む幅（offsetWidth）で行う（PaperFrame の measure）。Windows の常時
// スクロールバー（約 15px）があると、818〜832px の枠では机の左右の余白が 12px を割る
// （最小の 818px で約 4.5px）。用紙 794px は常に机に収まり横スクロールは出ないので、
// 余白が詰まるのは許容している。閾値を 833px に上げると、目標にした 824px の枠
// （Windows 150% で右パネルを開いたまま 80% 縮小）が流れる本文に戻ってしまう。
// clientWidth で判定すると、用紙にした途端に出るスクロールバーで境目の幅が行き来する。

/** 机の上下の余白（px）。左右より広く取る */
export const DESK_MARGIN_BLOCK_PX = 24;

/** 紙の見た目にするのに必要な枠の幅（用紙 + 左右の机） */
export const PAPER_MIN_FRAME_WIDTH_PX = Math.ceil(PAPER_WIDTH_PX + DESK_MARGIN_PX * 2);

/** 改ページの番号と用紙の右端の間の距離（px）。机の上でも用紙の右の余白の中でも同じ */
export const PAGE_NUMBER_GAP_PX = 8;

/** 改ページの番号の字の大きさ（px） */
export const PAGE_NUMBER_FONT_PX = 11;

/** 番号が机の右端にくっつかないよう、番号の右に残す余白（px） */
const PAGE_NUMBER_DESK_EDGE_PX = 4;

/**
 * 番号の幅の見積もり（px）。全角（かな・漢字など）は字の大きさ、それ以外は 0.6 倍で数える。
 * 実測せずに決められるので、置き場所の判定を純関数にできる。少し多めに見積もる。
 */
export function estimatePageNumberWidth(text: string, fontPx: number = PAGE_NUMBER_FONT_PX): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0) ?? 0) >= 0x2e80 ? fontPx : fontPx * 0.6;
  return Math.ceil(w);
}

/**
 * 改ページの番号の置き場所。
 * - desk: 用紙の右の机の上（用紙の右端から 8px 離す）
 * - paper: 右の机が番号の幅 + 余白に足りないとき、用紙の右の余白（約 20mm）の中に小さく置く
 *   （本文には重ならない。机は用紙がぎりぎり入る幅で 12px まで狭くなる）
 * 枠の幅（PaperFrame の根）が測れていない（null・0 以下）ときは机に置く。
 */
export function resolvePageNumberPlacement(
  frameWidthPx: number | null,
  labelWidthPx: number,
): "desk" | "paper" {
  if (frameWidthPx === null || !Number.isFinite(frameWidthPx) || frameWidthPx <= 0) return "desk";
  // 用紙は枠の中央にあるので、右の机の幅は左右同じ
  const deskRight = (frameWidthPx - PAPER_WIDTH_PX) / 2;
  return deskRight >= PAGE_NUMBER_GAP_PX + labelWidthPx + PAGE_NUMBER_DESK_EDGE_PX ? "desk" : "paper";
}

/** 今の本文の最大幅（note-app の maxWidth: 828 = 本文 720 + .bn-editor の左右 54px） */
export const FLOW_MAX_WIDTH_PX = 828;

/** 今の本文の左右の溝（.bn-editor の padding-inline）。用紙では 15mm に置き換わる */
export const FLOW_GUTTER_PX = 54;

/**
 * 枠の幅から見た目を決める。
 * 縮めて見せる（transform: scale / CSS zoom）ことはしない。本文に重ねて描く部品
 * （ハンドル・キャプション・ラベル）の位置がずれるため、狭いときは紙の見た目を
 * やめて流れる本文へ戻す。幅が未計測（null）のときも流れる本文にしておく。
 */
export function resolvePaperLayout(
  mode: PaperMode,
  frameWidthPx: number | null,
): PaperLayout {
  if (mode !== "a4") return "flow";
  if (frameWidthPx === null) return "flow";
  return frameWidthPx >= PAPER_MIN_FRAME_WIDTH_PX ? "sheet" : "flow";
}

/**
 * A4 を選んだのに紙の見た目にできていない（＝右上にアイコンを出す）か。
 * 幅が未計測（null）・0（ResizeObserver が無い環境・非表示の枠）のときは
 * 「狭い」と判断できないので出さない。
 */
export function shouldShowNarrowNotice(
  mode: PaperMode,
  layout: PaperLayout,
  frameWidthPx: number | null,
): boolean {
  if (frameWidthPx === null || frameWidthPx <= 0) return false;
  return mode === "a4" && layout === "flow";
}

/**
 * 右パネルを開くと、今出ている用紙が隠れる（枠が用紙 + 机より狭くなって流れる本文に戻る）か。
 * frameWidthNow は今の用紙の外枠（PaperFrame の根）の実寸、panelWidth は開くパネルの幅。
 * 測れない（非有限・0 以下）ときは隠れないと見なす（従来どおり開く）。
 */
export function wouldHidePaperSheet(frameWidthNow: number, panelWidth: number): boolean {
  if (!Number.isFinite(frameWidthNow) || frameWidthNow <= 0) return false;
  if (!Number.isFinite(panelWidth) || panelWidth < 0) return false;
  return frameWidthNow - panelWidth < PAPER_MIN_FRAME_WIDTH_PX;
}

/**
 * 右パネルの行（rightPanelRowRef）から、今出ている A4 用紙の外枠（PaperFrame の根）の実寸を返す。
 * 用紙が出ていない（標準ノート・流れる本文）ときは null。
 */
export function findPaperSheetWidth(row: Element | null): number | null {
  const root = row?.querySelector<HTMLElement>('[data-paper-layout="sheet"]');
  if (!root) return null;
  // PaperFrame の判定（measure）と同じく、本文枠の offsetWidth（縦スクロールバーを含む）で測る。
  // 根の実寸はスクロールバーのぶん狭く、境目の数 px で判定が食い違うため
  const pane = root.closest<HTMLElement>("[data-label-wrapper]");
  return pane ? Math.round(pane.offsetWidth) : root.getBoundingClientRect().width;
}

/**
 * PROV パネルを自動で開くか。モバイルは全画面表示なので常に開く（従来どおり）。
 * デスクトップでは、従来の幅判定（fitsByWidth）を満たし、かつ今出ている用紙を隠さないときだけ開く。
 * paperFrameWidth が null（用紙が出ていない）なら用紙の判定はしない。
 */
export function shouldAutoOpenProvPanel(args: {
  isDesktop: boolean;
  fitsByWidth: boolean;
  paperFrameWidth: number | null;
  panelWidth: number;
}): boolean {
  if (!args.isDesktop) return true;
  const hidesPaper =
    args.paperFrameWidth !== null &&
    wouldHidePaperSheet(args.paperFrameWidth, args.panelWidth);
  return !hidesPaper && args.fitsByWidth;
}
