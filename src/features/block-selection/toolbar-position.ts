// 複数ブロック選択のツールバーを置く位置（ビューポート座標・position:fixed 用）。
// 基本は選択の先頭ブロックの上。ただし本文の枠の上端までに置く空きが無ければ、
// 枠で切られて見えなくなるので、選択の最後のブロックの下に置く。
// 左右・上下の画面内への収めは共通の placeFloating に任せる。
import { placeFloating, type Rect } from "../../ui/floating-position";

export type SelectionToolbarPositionArgs = {
  /** 先頭の選択ブロックの矩形 */
  firstRect: Rect;
  /** 最後の選択ブロックの矩形 */
  lastRect: Rect;
  /** 選択を含む本文の枠の上端（ビューポート座標。枠が無ければ 0） */
  frameTop: number;
  toolbarSize: { width: number; height: number };
  viewport: { width: number; height: number };
  /** ブロックとの間（既定 8） */
  gap?: number;
};

export type SelectionToolbarPosition = {
  top: number;
  left: number;
  side: "above" | "below";
};

export function computeSelectionToolbarPosition(
  args: SelectionToolbarPositionArgs,
): SelectionToolbarPosition {
  const { firstRect, lastRect, frameTop, toolbarSize, viewport } = args;
  const gap = args.gap ?? 8;
  const margin = 8;
  // 上に置ける空き: 先頭ブロックの上端から、枠の上端（と画面の上端）まで
  const topLimit = Math.max(frameTop, 0) + margin;
  const roomAbove = firstRect.top - gap - topLimit;
  if (roomAbove >= toolbarSize.height) {
    const p = placeFloating({
      anchor: firstRect,
      size: toolbarSize,
      viewport,
      placement: "top-start",
      gap,
      margin,
    });
    return { top: p.top, left: p.left, side: "above" };
  }
  const p = placeFloating({
    anchor: lastRect,
    size: toolbarSize,
    viewport,
    placement: "bottom-start",
    gap,
    margin,
  });
  return { top: p.top, left: p.left, side: "below" };
}

/** 要素を切り取る（スクロールする）最も近い祖先の上端。無ければ 0 */
export function findFrameTop(el: Element | null): number {
  let cur = el?.parentElement ?? null;
  while (cur && cur !== document.body) {
    const oy = getComputedStyle(cur).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "hidden") {
      return cur.getBoundingClientRect().top;
    }
    cur = cur.parentElement;
  }
  return 0;
}
