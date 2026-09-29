// 案内の帯を避けた fit（C-5）
import { describe, it, expect, vi } from "vitest";
import {
  computeFitViewport,
  fitAvoidingHint,
  SELECTION_HINT_CLEARANCE,
} from "./fit-with-clearance";

/** モデル座標の範囲を視点に通した画面上の下端 */
function screenBottom(bb: { y2: number }, v: { zoom: number; pan: { y: number } }) {
  return bb.y2 * v.zoom + v.pan.y;
}
function screenTop(bb: { y1: number }, v: { zoom: number; pan: { y: number } }) {
  return bb.y1 * v.zoom + v.pan.y;
}

// 点検で崩れた枠: 右パネルの近傍グラフ（幅 479px・853x440 で高さ 284px、padding 20）
const BB = { x1: 0, y1: 0, x2: 437, y2: 240 };
const BASE = { bb: BB, width: 479, height: 284, padding: 20, minZoom: 0.1, maxZoom: 3 };

describe("computeFitViewport", () => {
  it("案内なし（bottomClearance 無し）は cytoscape の fit と同じ式", () => {
    const v = computeFitViewport(BASE)!;
    // zoom = min((479-40)/437, (284-40)/240) = min(1.0046, 1.0167)
    expect(v.zoom).toBeCloseTo(439 / 437, 6);
    // 余白 20 で中央: 下端は height - 20 以内
    expect(screenBottom(BB, v)).toBeLessThanOrEqual(284 - 20 + 0.001);
    expect(screenTop(BB, v)).toBeGreaterThanOrEqual(20 - 0.001);
  });

  it("案内の帯（下端から 26px）に食い込まない", () => {
    // 既存の fit だと、縦が制約のとき下端が H-20 まで来て帯（H-26〜）に 6px 掛かる
    const tall = { ...BASE, bb: { x1: 0, y1: 0, x2: 200, y2: 260 } };
    const without = computeFitViewport(tall)!;
    expect(screenBottom(tall.bb, without)).toBeGreaterThan(284 - 26);

    const withHint = computeFitViewport({ ...tall, bottomClearance: SELECTION_HINT_CLEARANCE })!;
    expect(screenBottom(tall.bb, withHint)).toBeLessThanOrEqual(284 - 26);
    // 上の余白 20 は保つ
    expect(screenTop(tall.bb, withHint)).toBeGreaterThanOrEqual(20 - 0.001);
  });

  it("下端の余白が padding 以下なら padding が効く（cy.fit と同じ）", () => {
    const a = computeFitViewport(BASE)!;
    const b = computeFitViewport({ ...BASE, bottomClearance: 10 })!;
    expect(b).toEqual(a);
  });

  it("拡大率は minZoom〜maxZoom に丸める", () => {
    const small = { ...BASE, bb: { x1: 0, y1: 0, x2: 10, y2: 10 } };
    expect(computeFitViewport(small)!.zoom).toBe(3);
    const huge = { ...BASE, bb: { x1: 0, y1: 0, x2: 100000, y2: 100000 } };
    expect(computeFitViewport(huge)!.zoom).toBe(0.1);
  });

  it("計算できないとき（空のグラフ・コンテナ 0px）は null", () => {
    expect(computeFitViewport({ ...BASE, bb: { x1: NaN, y1: NaN, x2: NaN, y2: NaN } })).toBeNull();
    expect(computeFitViewport({ ...BASE, width: 0 })).toBeNull();
    expect(computeFitViewport({ ...BASE, bb: { x1: 0, y1: 0, x2: 0, y2: 0 } })).toBeNull();
  });
});

describe("fitAvoidingHint", () => {
  function makeCy() {
    return {
      fit: vi.fn(),
      viewport: vi.fn(),
      elements: () => ({ boundingBox: () => BB }),
      width: () => 479,
      height: () => 284,
      minZoom: () => 0.1,
      maxZoom: () => 3,
    };
  }

  it("案内が出ていないときは今までどおり cy.fit を呼ぶ", () => {
    const cy = makeCy();
    fitAvoidingHint(cy, 20, false);
    expect(cy.fit).toHaveBeenCalledWith(undefined, 20);
    expect(cy.viewport).not.toHaveBeenCalled();
  });

  it("案内が出ているときは視点を自分で決める", () => {
    const cy = makeCy();
    fitAvoidingHint(cy, 20, true);
    expect(cy.fit).not.toHaveBeenCalled();
    expect(cy.viewport).toHaveBeenCalledTimes(1);
  });

  it("案内が出ていても計算できなければ cy.fit に戻る", () => {
    const cy = { ...makeCy(), width: () => 0 };
    fitAvoidingHint(cy, 20, true);
    expect(cy.fit).toHaveBeenCalledWith(undefined, 20);
  });
});
