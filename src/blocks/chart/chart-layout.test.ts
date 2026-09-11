// chart-layout.ts（サブプロットのレイアウト計算純関数）のテスト

import { describe, it, expect } from "vitest";
import { computePanelLayout, estimateLegendRows, PANEL_GAP, type PanelLayoutInput } from "./chart-layout";

const baseInput: PanelLayoutInput = {
  rows: 1,
  cols: 1,
  width: 800,
  height: 400,
  outer: { left: 40, right: 20, top: 10, bottom: 30 },
  xAxisSpace: 24,
  yAxisSpace: 48,
  joinVertical: false,
  joinHorizontal: false,
};

describe("computePanelLayout", () => {
  it("1×1 は outer を差し引いた 1 枚の矩形になる", () => {
    const result = computePanelLayout(baseInput);
    expect(result.grids).toEqual([
      { left: 40, top: 10, width: 800 - 40 - 20, height: 400 - 10 - 30 },
    ]);
    expect(result.showXAxis).toEqual([true]);
    expect(result.showYAxis).toEqual([true]);
  });

  it("3×1（join なし）は縦に xAxisSpace+PANEL_GAP 分の間隔を空けて並ぶ", () => {
    const result = computePanelLayout({ ...baseInput, rows: 3, cols: 1 });
    expect(result.grids).toHaveLength(3);
    const rowGap = baseInput.xAxisSpace + PANEL_GAP;
    const panelHeight = result.grids[0].height;
    expect(result.grids[1].top - result.grids[0].top).toBeCloseTo(panelHeight + rowGap);
    expect(result.grids[2].top - result.grids[1].top).toBeCloseTo(panelHeight + rowGap);
    // join なしなので全枠が自分の軸を出す
    expect(result.showXAxis).toEqual([true, true, true]);
    expect(result.showYAxis).toEqual([true, true, true]);
    // 列は 1 つなので left は全枠で一致
    expect(result.grids[1].left).toBe(result.grids[0].left);
    expect(result.grids[2].left).toBe(result.grids[0].left);
  });

  it("3×1（joinVertical）は隙間なく接し、最後の枠だけ X 軸を出す", () => {
    const result = computePanelLayout({ ...baseInput, rows: 3, cols: 1, joinVertical: true });
    expect(result.grids[0].top + result.grids[0].height).toBe(result.grids[1].top);
    expect(result.grids[1].top + result.grids[1].height).toBe(result.grids[2].top);
    expect(result.showXAxis).toEqual([false, false, true]);
    // Y 軸共有はしていないので全枠が出す
    expect(result.showYAxis).toEqual([true, true, true]);
  });

  it("2×2（join 両方あり）は縦横とも隙間なく接し、外周の枠だけ軸を出す", () => {
    const result = computePanelLayout({
      ...baseInput,
      rows: 2,
      cols: 2,
      joinVertical: true,
      joinHorizontal: true,
    });
    // index: 0=(0,0) 1=(0,1) 2=(1,0) 3=(1,1)
    expect(result.grids[0].left + result.grids[0].width).toBe(result.grids[1].left);
    expect(result.grids[0].top + result.grids[0].height).toBe(result.grids[2].top);
    expect(result.showXAxis).toEqual([false, false, true, true]);
    expect(result.showYAxis).toEqual([true, false, true, false]);
  });

  it("2×2（join 両方なし）は全枠が自分の軸を出し、行・列ごとに座標が厳密一致する", () => {
    const result = computePanelLayout({ ...baseInput, rows: 2, cols: 2 });
    expect(result.showXAxis).toEqual([true, true, true, true]);
    expect(result.showYAxis).toEqual([true, true, true, true]);
    // 列（left）は行に依らず一致
    expect(result.grids[2].left).toBe(result.grids[0].left);
    expect(result.grids[3].left).toBe(result.grids[1].left);
    // 行（top）は列に依らず一致
    expect(result.grids[1].top).toBe(result.grids[0].top);
    expect(result.grids[3].top).toBe(result.grids[2].top);
  });

  it("2×2（片方だけ join: 縦のみ）は列方向は軸を空け、行方向のみ詰まる", () => {
    const result = computePanelLayout({ ...baseInput, rows: 2, cols: 2, joinVertical: true });
    expect(result.grids[0].top + result.grids[0].height).toBe(result.grids[2].top);
    expect(result.showXAxis).toEqual([false, false, true, true]);
    expect(result.showYAxis).toEqual([true, true, true, true]);
  });

  it("幅が極端に小さいとき、枠は 0 未満にならない（例外も投げない）", () => {
    const result = computePanelLayout({
      ...baseInput,
      rows: 2,
      cols: 3,
      width: 10,
      height: 10,
    });
    for (const grid of result.grids) {
      expect(grid.width).toBeGreaterThanOrEqual(0);
      expect(grid.height).toBeGreaterThanOrEqual(0);
    }
  });

  it("rows/cols が 0 以下・非整数でも 1 以上の整数に正規化される", () => {
    const zero = computePanelLayout({ ...baseInput, rows: 0, cols: -1 });
    expect(zero.grids).toHaveLength(1);
    const fractional = computePanelLayout({ ...baseInput, rows: 2.9, cols: 1.1 });
    // floor(2.9)=2, floor(1.1)=1 → 2 枠
    expect(fractional.grids).toHaveLength(2);
  });
});

describe("estimateLegendRows", () => {
  it("項目が無ければ 0 行", () => {
    expect(estimateLegendRows([], 600, "horizontal", 12)).toBe(0);
  });

  it("収まるうちは 1 行", () => {
    expect(estimateLegendRows(["A", "B"], 600, "horizontal", 12)).toBe(1);
  });

  it("幅を超えたら折り返す", () => {
    const names = ["σ (S/cm)", "S (µV/K)", "PF (mW/mK²)", "κ (W/mK)"];
    expect(estimateLegendRows(names, 300, "horizontal", 12)).toBeGreaterThan(1);
    // 広ければ 1 行に収まる
    expect(estimateLegendRows(names, 2000, "horizontal", 12)).toBe(1);
  });

  it("実測が渡されればそちらを使う（近似より優先）", () => {
    const names = ["A", "B"];
    // 1 項目 400px 相当に測れたことにすると、600px には収まらない
    expect(estimateLegendRows(names, 600, "horizontal", 12, () => 400)).toBe(2);
    // 測れなければ近似に落ちる（0 以下を返す実装を想定）
    expect(estimateLegendRows(names, 600, "horizontal", 12, () => 0)).toBe(1);
  });

  it("縦並びは項目数がそのまま行数", () => {
    expect(estimateLegendRows(["A", "B", "C"], 600, "vertical", 12)).toBe(3);
  });

  it("幅が取れていないときも 1 行として扱う（0 除算・無限ループを作らない）", () => {
    expect(estimateLegendRows(["A", "B"], 0, "horizontal", 12)).toBe(1);
  });
});
