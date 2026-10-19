import { describe, it, expect } from "vitest";
import { labelFontSizeForZoom } from "./global-graph-view";

describe("labelFontSizeForZoom（ズームでラベルが巨大化しない）", () => {
  it("等倍では基本サイズ、寄せるほど小さく（画面上は √z でしか増えない）", () => {
    expect(labelFontSizeForZoom(1)).toBeCloseTo(11);
    expect(labelFontSizeForZoom(4)).toBeCloseTo(5.5);
    // 画面上の大きさ = px × zoom
    expect(labelFontSizeForZoom(4) * 4).toBeCloseTo(22);
  });
  it("引いても基本サイズより大きくはしない（下限 4px）", () => {
    expect(labelFontSizeForZoom(0.5)).toBeCloseTo(11);
    expect(labelFontSizeForZoom(0.01)).toBeLessThanOrEqual(11);
    expect(labelFontSizeForZoom(100)).toBeGreaterThanOrEqual(4);
  });
});
