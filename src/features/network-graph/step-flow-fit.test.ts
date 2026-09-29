// 手順フローの fit がボタン群の帯を避ける（B-6 / D-4 / C-5 の React Flow 側）
import { describe, it, expect } from "vitest";
import {
  fittedTopOffset,
  stepFlowFitPadding,
  STEP_FLOW_FIT_PADDING,
  STEP_FLOW_TOOLBAR_CLEARANCE,
} from "./step-flow-fit";

/** 右上のボタン群の下端（top 15px + 高さ 28px） */
const TOOLBAR_BOTTOM = 43;

// 点検の実測に近い形: 縦に長いノード群を、グラフ領域の高さ 338〜364px に収める
const BOUNDS = { x: 0, y: 0, width: 480, height: 340 };

describe("stepFlowFitPadding", () => {
  it("editor は上だけ px 指定、左右下は従来の割合", () => {
    expect(stepFlowFitPadding("editor")).toEqual({
      top: `${STEP_FLOW_TOOLBAR_CLEARANCE}px`,
      right: STEP_FLOW_FIT_PADDING,
      bottom: STEP_FLOW_FIT_PADDING,
      left: STEP_FLOW_FIT_PADDING,
    });
  });

  it("preview は従来のまま（先頭寄せの独自の上余白を持つ）", () => {
    expect(stepFlowFitPadding("preview")).toBe(STEP_FLOW_FIT_PADDING);
  });

  it("上余白はボタン群の下端より外にある", () => {
    expect(STEP_FLOW_TOOLBAR_CLEARANCE).toBeGreaterThan(TOOLBAR_BOTTOM);
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
      const after = fittedTopOffset(BOUNDS, frame, stepFlowFitPadding("editor"), 0.2, 1);
      expect(before).toBeLessThan(TOOLBAR_BOTTOM);
      expect(after).toBeGreaterThanOrEqual(TOOLBAR_BOTTOM);
    });
  }

  it("1280x660 相当の余裕のある枠（高さ 500px）でも帯を避けたまま", () => {
    const after = fittedTopOffset(BOUNDS, { width: 477, height: 500 }, stepFlowFitPadding("editor"), 0.2, 1);
    expect(after).toBeGreaterThanOrEqual(TOOLBAR_BOTTOM);
  });
});
