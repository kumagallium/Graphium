// 手順フロー（React Flow）の fitView の余白。
//
// 右上のボタン群（整列 / パラメータ / 手順を追加）は React Flow の
// <Panel position="top-right"> で、キャンバスの上に重ねて浮かべている（top 15px・高さ
// 28px ＝ 枠内の y 15〜43）。fitView の余白が割合だけだと、高さの低い枠（グラフ領域が
// 340px 前後）でノード群が上まで使い、上段のノードがこの帯の下に潜る。
// 上の余白だけ、ボタン群の下端の外まで取る。

import { getViewportForBounds, type FitViewOptions } from "@xyflow/react";

/** 従来の余白（割合）。React Flow が上下左右へ同じ割合で解釈する */
export const STEP_FLOW_FIT_PADDING = 0.15;

/** 右上のボタン群の下端（43px）の外に空ける上余白（px） */
export const STEP_FLOW_TOOLBAR_CLEARANCE = 56;

/**
 * fitView / fitViewOptions に渡す padding。
 * - editor: 上だけボタン群の帯を避ける。左右下は従来どおりの割合
 * - preview: 先頭寄せの独自の上余白（PREVIEW_TOP_PADDING）を持つので従来のまま
 */
export function stepFlowFitPadding(variant: "editor" | "preview"): NonNullable<FitViewOptions["padding"]> {
  if (variant === "preview") return STEP_FLOW_FIT_PADDING;
  return {
    top: `${STEP_FLOW_TOOLBAR_CLEARANCE}px`,
    right: STEP_FLOW_FIT_PADDING,
    bottom: STEP_FLOW_FIT_PADDING,
    left: STEP_FLOW_FIT_PADDING,
  };
}

/**
 * 範囲を fitView と同じ式で視点に通したときの、範囲の上端の画面 y 座標。
 * 上段のノードがボタン群の帯（〜43px）に掛かるかを確かめるテスト用。
 */
export function fittedTopOffset(
  bounds: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  padding: NonNullable<FitViewOptions["padding"]>,
  minZoom: number,
  maxZoom: number,
): number {
  const v = getViewportForBounds(bounds, frame.width, frame.height, minZoom, maxZoom, padding);
  return bounds.y * v.zoom + v.y;
}
