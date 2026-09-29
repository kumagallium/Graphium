// 手順フロー（React Flow）の fitView の余白。
//
// 右上のボタン群（整列 / パラメータ / 手順を追加）は React Flow の
// <Panel position="top-right"> で、キャンバスの上に重ねて浮かべている（top 15px・高さ
// 28px ＝ 枠内の y 15〜43）。fitView の余白が割合だけだと、高さの低い枠（グラフ領域が
// 340px 前後）でノード群が上まで使い、上段のノードがこの帯の下に潜る。
// 上の余白だけ、ボタン群の下端の外まで取る（従来の割合分がそれを超える高い枠では、
// 従来と同じ上余白のまま。狭い枠を直すために広い枠の見え方を変えない）。

import type { FitViewOptions } from "@xyflow/react";

/** 従来の余白（割合）。React Flow が上下左右へ同じ割合で解釈する */
export const STEP_FLOW_FIT_PADDING = 0.15;

/** 右上のボタン群の下端（43px）の外に空ける上余白（px） */
export const STEP_FLOW_TOOLBAR_CLEARANCE = 56;

/** React Flow が数値の余白（割合）を px に直す式（@xyflow/system の parsePadding と同じ） */
export function legacyPaddingPx(padding: number, viewport: number): number {
  return Math.floor((viewport - viewport / (1 + padding)) * 0.5);
}

/**
 * fitView / fitViewOptions に渡す padding。
 * - editor: 上だけ max(従来の割合分, ボタン群を避ける px)。左右下は従来どおりの割合
 * - preview: 先頭寄せの独自の上余白（PREVIEW_TOP_PADDING）を持つので従来のまま
 * frameHeight は React Flow の枠の高さ（px）。未確定（0）のときは従来の割合分が 0 になり、
 * ボタン群を避ける値になる
 */
export function stepFlowFitPadding(
  variant: "editor" | "preview",
  frameHeight = 0,
): NonNullable<FitViewOptions["padding"]> {
  if (variant === "preview") return STEP_FLOW_FIT_PADDING;
  const top = Math.max(legacyPaddingPx(STEP_FLOW_FIT_PADDING, frameHeight), STEP_FLOW_TOOLBAR_CLEARANCE);
  return {
    top: `${top}px`,
    right: STEP_FLOW_FIT_PADDING,
    bottom: STEP_FLOW_FIT_PADDING,
    left: STEP_FLOW_FIT_PADDING,
  };
}
