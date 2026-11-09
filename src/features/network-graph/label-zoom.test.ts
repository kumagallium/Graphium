import { describe, it, expect } from "vitest";
import { labelFontSizeForZoom } from "./global-graph-view";

describe("labelFontSizeForZoom（ズームでラベルが巨大化しない）", () => {
  it("等倍では基本サイズ、寄せても画面上の大きさは z^0.2 でしか増えない", () => {
    expect(labelFontSizeForZoom(1)).toBeCloseTo(11);
    // 画面上の大きさ = px × zoom。最大ズーム 3 でも 11px の 1.25 倍ほど
    expect(labelFontSizeForZoom(3) * 3).toBeCloseTo(11 * Math.pow(3, 0.2));
    expect(labelFontSizeForZoom(3) * 3).toBeLessThan(14);
  });
  it("引いても基本サイズより大きくはしない（下限 2px）", () => {
    expect(labelFontSizeForZoom(0.5)).toBeCloseTo(11);
    expect(labelFontSizeForZoom(0.01)).toBeLessThanOrEqual(11);
    expect(labelFontSizeForZoom(100)).toBeGreaterThanOrEqual(2);
  });
});
