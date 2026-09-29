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

/** 右上のボタン群の下端（43px）の外に空ける上余白（px）。ボタン群が 1 行（高さ 28px）のときの値 */
export const STEP_FLOW_TOOLBAR_CLEARANCE = 56;

/** ボタン群（Panel）の上端の位置（React Flow の Panel の既定マージン 15px） */
export const STEP_FLOW_TOOLBAR_TOP = 15;
/** ボタン群の下端とノードの間に空ける隙間（px）。15 + 28 + 13 = 56 */
export const STEP_FLOW_TOOLBAR_GAP = 13;

/**
 * ボタン群の実測の高さから、上余白（px）を決める。細いパネルではボタン群が折り返して
 * 2〜3 行（高さ 46〜100px）になり、1 行前提の 56px ではノードに被る（B-6 / D-4 の直り残り）。
 * 測れていない（0 以下・非有限）ときは従来の 56px。1 行のときも同じ 56px になる。
 */
export function stepFlowToolbarClearance(toolbarHeight = 0): number {
  if (!Number.isFinite(toolbarHeight) || toolbarHeight <= 0) return STEP_FLOW_TOOLBAR_CLEARANCE;
  return Math.max(
    STEP_FLOW_TOOLBAR_CLEARANCE,
    Math.ceil(STEP_FLOW_TOOLBAR_TOP + toolbarHeight + STEP_FLOW_TOOLBAR_GAP),
  );
}

/** React Flow が数値の余白（割合）を px に直す式（@xyflow/system の parsePadding と同じ） */
export function legacyPaddingPx(padding: number, viewport: number): number {
  return Math.floor((viewport - viewport / (1 + padding)) * 0.5);
}

/**
 * fitView / fitViewOptions に渡す padding。
 * - editor: 上だけ max(従来の割合分, ボタン群を避ける px)。左右下は従来どおりの割合
 * - preview: 先頭寄せの独自の上余白（PREVIEW_TOP_PADDING）を持つので従来のまま
 * frameHeight は React Flow の枠の高さ（px）。未確定（0）のときは従来の割合分が 0 になり、
 * ボタン群を避ける値になる。toolbarHeight はボタン群の実測の高さ（px。未測定なら 0）
 */
export function stepFlowFitPadding(
  variant: "editor" | "preview",
  frameHeight = 0,
  hintBottomClearance = 0,
  toolbarHeight = 0,
): NonNullable<FitViewOptions["padding"]> {
  if (variant === "preview") return STEP_FLOW_FIT_PADDING;
  const legacy = legacyPaddingPx(STEP_FLOW_FIT_PADDING, frameHeight);
  const top = Math.max(legacy, stepFlowToolbarClearance(toolbarHeight));
  return {
    top: `${top}px`,
    right: STEP_FLOW_FIT_PADDING,
    // 下端の案内の帯（GraphSelectionHint）が出ているときだけ、帯の上端の外まで取る。
    // 出ていない・従来の割合分がそれを超える高い枠では従来の割合のまま
    bottom:
      hintBottomClearance > 0 && hintBottomClearance > legacy
        ? `${hintBottomClearance}px`
        : STEP_FLOW_FIT_PADDING,
    left: STEP_FLOW_FIT_PADDING,
  };
}

/** 案内の帯の高さ（11px の文字 1 行）と、帯とノードの間に空ける隙間（px） */
const HINT_BAND_HEIGHT = 16;
const HINT_GAP = 6;

/**
 * 案内の帯を避けるための、下端からの距離（px）。bottom は GraphSelectionHint に渡す
 * 下端からの位置。案内が出ていない（show が false）ときは 0（＝避けない）。
 */
export function stepFlowHintClearance(show: boolean, bottom: number): number {
  return show ? bottom + HINT_BAND_HEIGHT + HINT_GAP : 0;
}
