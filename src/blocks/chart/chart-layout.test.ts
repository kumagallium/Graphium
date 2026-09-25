// chart-layout.ts（サブプロットのレイアウト計算純関数）のテスト

import { describe, it, expect } from "vitest";
import {
  approxTextWidth,
  axisSplitNumber,
  COMPACT_CHART_WIDTH,
  computeFigureHeight,
  computeFigureMargins,
  computePanelLayout,
  estimateLegendRows,
  isCompactChart,
  LEGEND_LINE_HEIGHT,
  LEGEND_ROW_PITCH,
  MIN_COMPACT_PANEL_HEIGHT,
  PANEL_GAP,
  valueAxisTickLabels,
  type FigureMarginsInput,
  type PanelLayoutInput,
} from "./chart-layout";

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

  it("記号枠の幅を詰めると、同じ幅により多く並ぶ（散布図だけの凡例）", () => {
    // 1 項目 = 文字 100 + 記号 + 5 + 10。記号 50 なら 165×2 = 330 > 300、記号 14 なら 129×2 = 258
    const names = ["A", "B"];
    expect(estimateLegendRows(names, 300, "horizontal", 12, () => 100)).toBe(2);
    expect(estimateLegendRows(names, 300, "horizontal", 12, () => 100, 14)).toBe(1);
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

// ── 狭い場所（サイドピーク等）の図 ────────────────────────────────
// 2026-09-25 の実測: 幅 1024px のウィンドウでメインとピークを並べると、ピークの図は
// 幅 224px で描画領域 108×46px、メイン側は 175px で 59×12px まで潰れた

describe("isCompactChart", () => {
  it("境界より狭い図だけがコンパクト。幅を測れていない（0）ときは通常", () => {
    expect(isCompactChart(224)).toBe(true);
    expect(isCompactChart(COMPACT_CHART_WIDTH - 1)).toBe(true);
    expect(isCompactChart(COMPACT_CHART_WIDTH)).toBe(false);
    expect(isCompactChart(720)).toBe(false);
    expect(isCompactChart(0)).toBe(false);
  });
});

describe("computeFigureMargins", () => {
  const base: FigureMarginsInput = {
    compact: false,
    anyYName: true,
    anyXName: true,
    anyUseRight: false,
    anyYRightName: false,
    legendTop: true,
    legendBottom: false,
    legendRows: 1,
  };

  it("通常の図は従来の固定値のまま（既存ノートの図を動かさない）", () => {
    expect(computeFigureMargins(base)).toEqual({
      left: 84,
      right: 32,
      top: 48,
      bottom: 64,
      xAxisSpace: 64,
      yNameGap: 52,
      yRightNameGap: 52,
      xNameGap: 34,
    });
    const bare = computeFigureMargins({ ...base, anyYName: false, anyXName: false, legendTop: false });
    expect([bare.left, bare.top, bare.bottom, bare.xAxisSpace]).toEqual([60, 20, 40, 40]);
    const right = computeFigureMargins({ ...base, anyUseRight: true, anyYRightName: true });
    expect(right.right).toBe(84);
    // 通常の図は目盛りラベルの幅を見ない
    expect(computeFigureMargins({ ...base, yLabelWidth: 200 }).left).toBe(84);
  });

  it("通常の図の凡例の行は従来の見積もり（1 行 17px）で空ける", () => {
    const three = computeFigureMargins({ ...base, legendRows: 3 });
    expect(three.top).toBe(48 + 2 * LEGEND_LINE_HEIGHT);
    const bottom = computeFigureMargins({ ...base, legendTop: false, legendBottom: true, legendRows: 2 });
    expect(bottom.bottom).toBe(64 + 32 + LEGEND_LINE_HEIGHT);
  });

  it("コンパクトは縦軸名を目盛りラベルのすぐ外に置き、左の余白をそのぶんだけにする", () => {
    // ラベル 24px（"4.5"）: 軸線 → 8 → ラベル 24 → 8 → 軸名 20 → 4
    const m = computeFigureMargins({ ...base, compact: true, yLabelWidth: 24 });
    expect(m.yNameGap).toBe(8 + 24 + 8);
    expect(m.left).toBe(8 + 24 + 8 + 20 + 4);
    // ラベルが長ければ余白も軸名の間隔も広がる（軸名がラベルに重ならない）
    const wide = computeFigureMargins({ ...base, compact: true, yLabelWidth: 34 });
    expect(wide.yNameGap - m.yNameGap).toBe(10);
    expect(wide.left - m.left).toBe(10);
    // 軸名が無ければ軸名の幅は取らない
    const unnamed = computeFigureMargins({ ...base, compact: true, anyYName: false, yLabelWidth: 24 });
    expect(unnamed.left).toBe(8 + 24 + 4);
  });

  it("コンパクトの右は第 2 軸があればそのラベル幅から、無ければ最後の目盛りラベルの半分ぶん", () => {
    const none = computeFigureMargins({ ...base, compact: true, yLabelWidth: 24 });
    expect(none.right).toBe(16);
    const withRight = computeFigureMargins({
      ...base,
      compact: true,
      anyUseRight: true,
      anyYRightName: true,
      yLabelWidth: 24,
      yRightLabelWidth: 10,
    });
    expect(withRight.yRightNameGap).toBe(8 + 10 + 8);
    expect(withRight.right).toBe(8 + 10 + 8 + 20 + 4);
  });

  it("コンパクトは上下の空きを詰め、凡例の折り返しは実際の行送り（24px）で空ける", () => {
    const m = computeFigureMargins({ ...base, compact: true, yLabelWidth: 24 });
    const normal = computeFigureMargins(base);
    expect(m.top).toBeLessThan(normal.top);
    expect(m.bottom).toBeLessThan(normal.bottom);
    const three = computeFigureMargins({ ...base, compact: true, yLabelWidth: 24, legendRows: 3 });
    expect(three.top - m.top).toBe(2 * LEGEND_ROW_PITCH);
  });
});

describe("computeFigureHeight", () => {
  const margins = { top: 38, bottom: 56, xAxisSpace: 56 };

  it("通常の図は幅 ÷ アスペクト比（従来と同じ）", () => {
    expect(
      computeFigureHeight({ width: 564, aspectRatio: Math.SQRT2, compact: false, rows: 1, margins, joinVertical: false })
    ).toBe(Math.round(564 / Math.SQRT2));
    // 5:1 のように余白で描画領域が潰れる比でも、通常の図は伸ばさない（ユーザーが選んだ形）
    expect(
      computeFigureHeight({ width: 712, aspectRatio: 5, compact: false, rows: 1, margins, joinVertical: false })
    ).toBe(Math.round(712 / 5));
  });

  it("コンパクトは描画領域が枠 1 段あたり最低限の高さになるまで伸ばす", () => {
    const h = computeFigureHeight({ width: 224, aspectRatio: Math.SQRT2, compact: true, rows: 1, margins, joinVertical: false });
    expect(h - margins.top - margins.bottom).toBe(MIN_COMPACT_PANEL_HEIGHT);
    // 5:1 でも同じだけ確保する（比を守ると高さ 45px で何も読めない）
    const spectrum = computeFigureHeight({ width: 224, aspectRatio: 5, compact: true, rows: 1, margins, joinVertical: false });
    expect(spectrum).toBe(h);
  });

  it("コンパクトでもアスペクト比のほうが高ければそちらを使う", () => {
    const h = computeFigureHeight({ width: 390, aspectRatio: 1, compact: true, rows: 1, margins, joinVertical: false });
    expect(h).toBe(390);
  });

  it("分割した図は段ごとに確保し、つなげない段の間隔も足す", () => {
    const joined = computeFigureHeight({ width: 224, aspectRatio: Math.SQRT2, compact: true, rows: 2, margins, joinVertical: true });
    expect(joined).toBe(margins.top + margins.bottom + 2 * MIN_COMPACT_PANEL_HEIGHT);
    const separate = computeFigureHeight({ width: 224, aspectRatio: Math.SQRT2, compact: true, rows: 2, margins, joinVertical: false });
    expect(separate - joined).toBe(margins.xAxisSpace + PANEL_GAP);
    // 分割の結果、各段が本当にその高さを持つ
    const layout = computePanelLayout({
      rows: 2,
      cols: 1,
      width: 224,
      height: separate,
      outer: { left: 60, right: 16, top: margins.top, bottom: margins.bottom },
      xAxisSpace: margins.xAxisSpace,
      yAxisSpace: 60,
      joinVertical: false,
      joinHorizontal: false,
    });
    expect(layout.grids.map((g) => g.height)).toEqual([MIN_COMPACT_PANEL_HEIGHT, MIN_COMPACT_PANEL_HEIGHT]);
  });
});

describe("axisSplitNumber", () => {
  it("既定の 5 分割で収まる長さなら何も指定しない（ECharts の既定に任せる）", () => {
    expect(axisSplitNumber(200, 32)).toBeUndefined();
    expect(axisSplitNumber(600, 64)).toBeUndefined();
  });

  it("短い軸は 1 目盛りあたりの間隔を確保できる数に減らす", () => {
    // 高さ 120px の縦軸（文字 16px の 2 倍 = 32px 間隔）→ 3 分割
    expect(axisSplitNumber(120, 32)).toBe(3);
    // 幅 144px の横軸（64px 間隔）→ 2 分割
    expect(axisSplitNumber(144, 64)).toBe(2);
  });

  it("下限は 2（1 分割だと刻みが大きく丸められ、軸の範囲がデータより広がる）", () => {
    expect(axisSplitNumber(46, 32)).toBe(2);
    expect(axisSplitNumber(10, 64)).toBe(2);
  });

  it("長さが測れていないときは何も指定しない", () => {
    expect(axisSplitNumber(0, 32)).toBeUndefined();
    expect(axisSplitNumber(Number.NaN, 32)).toBeUndefined();
  });
});

describe("valueAxisTickLabels", () => {
  it("ECharts と同じ刻み（1・2・3・5 × 10^n）で、端まで広げたラベルを返す", () => {
    // 4.0〜7.2 を 5 分割: 0.64 → 0.5 刻み、4〜7.5
    expect(valueAxisTickLabels({ min: 4, max: 7.2 }, 5)).toEqual([
      "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5",
    ]);
    // 3 分割: 1.07 → 1 刻み、4〜8（実機のサイドピークで出たラベルと同じ）
    expect(valueAxisTickLabels({ min: 4, max: 7.2 }, 3)).toEqual(["4", "5", "6", "7", "8"]);
  });

  it("端の値が整数でも、間に小数のラベルが出ることを拾う", () => {
    const labels = valueAxisTickLabels({ min: 24.1, max: 26 }, 3);
    expect(labels).toContain("24.5");
    expect(labels).toContain("26");
  });

  it("千の位から 3 桁区切りになる（ECharts の数値ラベルと同じ書式）", () => {
    expect(valueAxisTickLabels({ min: 0, max: 12000 }, 5)).toContain("12,000");
  });

  it("明示した最小値・最大値は、その値自身の桁数でそのままラベルになる", () => {
    const labels = valueAxisTickLabels({ min: 0.25, max: 10 }, 5, { min: true, max: true });
    expect(labels).toContain("0.25");
    expect(labels).toContain("10");
  });

  it("幅 0 の範囲・負の値・数でない範囲", () => {
    expect(valueAxisTickLabels({ min: 5, max: 5 }, 5).length).toBeGreaterThan(1);
    expect(valueAxisTickLabels({ min: -12.5, max: 3 }, 5)).toContain("-15");
    expect(valueAxisTickLabels({ min: Number.NaN, max: 1 }, 5)).toEqual([]);
  });
});

describe("approxTextWidth", () => {
  it("全角は 1em、それ以外は 0.62em で近似する", () => {
    expect(approxTextWidth("ab", 10)).toBeCloseTo(12.4);
    expect(approxTextWidth("温度", 10)).toBe(20);
  });
});
