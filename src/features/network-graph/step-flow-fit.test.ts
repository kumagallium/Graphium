// 手順フローの fit がボタン群の帯を避ける（B-6 / D-4 / C-5 の React Flow 側）
import { describe, it, expect } from "vitest";
import { getViewportForBounds, type FitViewOptions } from "@xyflow/react";
import {
  legacyPaddingPx,
  stepFlowFitPadding,
  stepFlowHintClearance,
  stepFlowToolbarClearance,
  STEP_FLOW_FIT_PADDING,
  STEP_FLOW_TOOLBAR_CLEARANCE,
} from "./step-flow-fit";

/** 右上のボタン群の下端（top 15px + 高さ 28px） */
const TOOLBAR_BOTTOM = 43;

// 点検の実測に近い形: 縦に長いノード群を、グラフ領域の高さ 338〜364px に収める
const BOUNDS = { x: 0, y: 0, width: 480, height: 340 };

/**
 * 範囲を fitView と同じ式で視点に通したときの、範囲の上端の画面 y 座標。
 * 上段のノードがボタン群の帯（〜43px）に掛かるかを確かめる。
 */
function fittedTopOffset(
  bounds: { x: number; y: number; width: number; height: number },
  frame: { width: number; height: number },
  padding: NonNullable<FitViewOptions["padding"]>,
  minZoom: number,
  maxZoom: number,
): number {
  const v = getViewportForBounds(bounds, frame.width, frame.height, minZoom, maxZoom, padding);
  return bounds.y * v.zoom + v.y;
}

describe("stepFlowFitPadding", () => {
  it("editor は上だけ px 指定、左右下は従来の割合", () => {
    expect(stepFlowFitPadding("editor", 364)).toEqual({
      top: `${STEP_FLOW_TOOLBAR_CLEARANCE}px`,
      right: STEP_FLOW_FIT_PADDING,
      bottom: STEP_FLOW_FIT_PADDING,
      left: STEP_FLOW_FIT_PADDING,
    });
  });

  it("preview は従来のまま（先頭寄せの独自の上余白を持つ）", () => {
    expect(stepFlowFitPadding("preview", 364)).toBe(STEP_FLOW_FIT_PADDING);
  });

  it("上余白はボタン群の下端より外にある", () => {
    expect(STEP_FLOW_TOOLBAR_CLEARANCE).toBeGreaterThan(TOOLBAR_BOTTOM);
  });

  it("枠の高さが未確定（0）でもボタン群を避ける", () => {
    expect((stepFlowFitPadding("editor") as { top: string }).top).toBe(`${STEP_FLOW_TOOLBAR_CLEARANCE}px`);
  });
});

describe("fitView の上端", () => {
  const frames = [
    { name: "1024x528", width: 477, height: 364 },
    { name: "853x440", width: 477, height: 338 },
  ];

  for (const frame of frames) {
    it(`${frame.name}: 従来の余白ではノードがボタン群の帯に入り、直した余白では入らない`, () => {
      const before = fittedTopOffset(BOUNDS, frame, STEP_FLOW_FIT_PADDING, 0.2, 1);
      const after = fittedTopOffset(BOUNDS, frame, stepFlowFitPadding("editor", frame.height), 0.2, 1);
      expect(before).toBeLessThan(TOOLBAR_BOTTOM);
      expect(after).toBeGreaterThanOrEqual(TOOLBAR_BOTTOM);
    });
  }

  it("1280x660 相当の余裕のある枠（高さ 500px）でも帯を避けたまま", () => {
    const after = fittedTopOffset(BOUNDS, { width: 477, height: 500 }, stepFlowFitPadding("editor", 500), 0.2, 1);
    expect(after).toBeGreaterThanOrEqual(TOOLBAR_BOTTOM);
  });
});

describe("高い枠では従来の上余白のまま", () => {
  it("従来の割合分が 56px を超える高さでは、その値を上余白にする", () => {
    for (const h of [900, 1000, 1200]) {
      const legacy = legacyPaddingPx(STEP_FLOW_FIT_PADDING, h);
      expect(legacy).toBeGreaterThan(STEP_FLOW_TOOLBAR_CLEARANCE);
      expect((stepFlowFitPadding("editor", h) as { top: string }).top).toBe(`${legacy}px`);
    }
  });

  it("高い枠の fit は従来（割合だけ）と同じ視点になる", () => {
    const frame = { width: 900, height: 1000 };
    const a = getViewportForBounds(BOUNDS, frame.width, frame.height, 0.2, 1, STEP_FLOW_FIT_PADDING);
    const b = getViewportForBounds(BOUNDS, frame.width, frame.height, 0.2, 1, stepFlowFitPadding("editor", frame.height));
    expect(b).toEqual(a);
  });

  it("低い枠では 56px（従来の割合分は 56px 未満）", () => {
    expect(legacyPaddingPx(STEP_FLOW_FIT_PADDING, 364)).toBeLessThan(STEP_FLOW_TOOLBAR_CLEARANCE);
    expect((stepFlowFitPadding("editor", 364) as { top: string }).top).toBe(`${STEP_FLOW_TOOLBAR_CLEARANCE}px`);
  });
});

describe("下端の案内の帯を避ける", () => {
  it("案内が出ていないときは従来の割合のまま", () => {
    expect((stepFlowFitPadding("editor", 340, stepFlowHintClearance(false, 10)) as { bottom: unknown }).bottom).toBe(STEP_FLOW_FIT_PADDING);
  });

  it("低い枠では下余白を帯の上端の外まで取る", () => {
    const c = stepFlowHintClearance(true, 10);
    expect(c).toBeGreaterThan(10 + 16);
    expect((stepFlowFitPadding("editor", 340, c) as { bottom: unknown }).bottom).toBe(`${c}px`);
  });

  it("従来の割合分が帯を超える高い枠では割合のまま", () => {
    const c = stepFlowHintClearance(true, 10);
    expect((stepFlowFitPadding("editor", 900, c) as { bottom: unknown }).bottom).toBe(STEP_FLOW_FIT_PADDING);
  });

  it("接続ヒントを避けて上げた案内でも避ける", () => {
    expect(stepFlowHintClearance(true, 32)).toBeGreaterThan(stepFlowHintClearance(true, 10));
  });
});

describe("ボタン群の実測の高さを上余白に使う", () => {
  it("1 行（28px）のときは従来の 56px と同じ", () => {
    expect(stepFlowToolbarClearance(28)).toBe(STEP_FLOW_TOOLBAR_CLEARANCE);
  });

  it("測れていない（0・負・非有限）ときは従来の 56px", () => {
    for (const h of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(stepFlowToolbarClearance(h)).toBe(STEP_FLOW_TOOLBAR_CLEARANCE);
    }
    expect(stepFlowToolbarClearance()).toBe(STEP_FLOW_TOOLBAR_CLEARANCE);
  });

  it("折り返して高くなるほど、上余白は下端（15 + 高さ）の外まで伸びる", () => {
    // 2 行 = 62px、3 行 = 96px 前後（点検の実測 46〜100px）
    for (const h of [46, 62, 100]) {
      const c = stepFlowToolbarClearance(h);
      expect(c).toBeGreaterThan(15 + h);
      expect(c).toBeGreaterThan(STEP_FLOW_TOOLBAR_CLEARANCE - 1);
    }
  });

  it("stepFlowFitPadding の上余白に反映される（低い枠）", () => {
    const top = (h: number) =>
      (stepFlowFitPadding("editor", 338, 0, h) as { top: string }).top;
    expect(top(0)).toBe(`${STEP_FLOW_TOOLBAR_CLEARANCE}px`);
    expect(top(100)).toBe(`${stepFlowToolbarClearance(100)}px`);
  });

  it("折り返したボタン群の下でも、ノード群の上端が帯に入らない（853x440 のパネル 197px 相当）", () => {
    const frame = { width: 194, height: 338 };
    const toolbarBottom = 15 + 100;
    const after = fittedTopOffset(BOUNDS, frame, stepFlowFitPadding("editor", frame.height, 0, 100), 0.2, 1);
    expect(after).toBeGreaterThanOrEqual(toolbarBottom);
  });

  it("preview はボタン群の高さに関わらず従来のまま", () => {
    expect(stepFlowFitPadding("preview", 364, 0, 100)).toBe(STEP_FLOW_FIT_PADDING);
  });
});
