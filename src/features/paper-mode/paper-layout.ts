// A4 の用紙の幅で書く表示（試作）— 用紙の寸法と「紙の見た目にできる広さか」の判定
//
// 数字は印刷（src/app.css の `@page { size: A4 portrait; margin: 15mm; }` と
// `#graphium-print-root { width: 180mm }`）と揃えてある。画面で見る幅と印刷の折り返しを
// 一致させるのが目的なので、ここを動かすときは印刷側も同時に見ること。

export type PaperMode = "standard" | "a4";

/**
 * 実際に描く見た目。
 * - sheet: 机の上に用紙を置く（A4 かつ枠が十分に広い）
 * - flow: 今と同じ流れる本文（standard、または A4 だが枠が用紙より狭い）
 */
export type PaperLayout = "flow" | "sheet";

/** CSS の 1mm は 96/25.4 px */
const PX_PER_MM = 96 / 25.4;

/** 用紙の幅（A4 = 210mm。96dpi で約 794px） */
export const PAPER_WIDTH_PX = Math.ceil(210 * PX_PER_MM);

/** 用紙の左右・上下の余白（15mm。約 57px。ドラッグハンドル 48px が収まる） */
export const PAPER_MARGIN_PX = Math.round(15 * PX_PER_MM);

/** 用紙の左右に最低限残す机の余白（px）。これを取れない枠では紙の見た目をやめる */
export const DESK_MARGIN_PX = 24;

/** 紙の見た目にするのに必要な枠の幅（用紙 + 左右の机） */
export const PAPER_MIN_FRAME_WIDTH_PX = PAPER_WIDTH_PX + DESK_MARGIN_PX * 2;

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

/** A4 を選んだのに紙の見た目にできていない（＝上部に注意書きを出す）か */
export function shouldShowNarrowNotice(
  mode: PaperMode,
  layout: PaperLayout,
): boolean {
  return mode === "a4" && layout === "flow";
}
