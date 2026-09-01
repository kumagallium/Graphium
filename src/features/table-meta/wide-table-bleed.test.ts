import { describe, expect, it } from "vitest";
import { computeTableBleed, CONTENT_COLUMN_WIDTH, EDITOR_GUTTER } from "./wide-table-bleed";

describe("computeTableBleed", () => {
  it("中央寄せで余った片側 + ハンドル溝ぶんだけ張り出す", () => {
    // 1512px ウィンドウ・右パネル open のときのペイン幅
    const bleed = computeTableBleed({ paneWidth: 1007, padLeft: 24, padRight: 24, fullWidth: false });
    // avail = 959, 余白 = (959 - 828) / 2 = 65.5, + 54
    expect(bleed).toBe(120);
  });

  it("ラベルバッジで右パディングが広がると、その分は食わない", () => {
    const withoutLabels = computeTableBleed({ paneWidth: 1007, padLeft: 24, padRight: 24, fullWidth: false });
    const withLabels = computeTableBleed({ paneWidth: 1007, padLeft: 24, padRight: 80, fullWidth: false });
    // バッジ領域 56px ぶん avail が減り、その半分だけ張り出しが縮む
    expect(withLabels).toBeLessThan(withoutLabels);
    expect(withoutLabels - withLabels).toBe(28);
  });

  it("ペインが本文カラムより狭ければ、ハンドル溝ぶんだけになる", () => {
    const bleed = computeTableBleed({ paneWidth: 600, padLeft: 16, padRight: 16, fullWidth: false });
    expect(bleed).toBe(EDITOR_GUTTER);
  });

  it("fullWidth では中央寄せの余白が無いので、ハンドル溝ぶんだけになる", () => {
    const bleed = computeTableBleed({ paneWidth: 1600, padLeft: 24, padRight: 24, fullWidth: true });
    expect(bleed).toBe(EDITOR_GUTTER);
  });

  it("ペイン幅が広いほど張り出せるが、常に有限で非負", () => {
    const narrow = computeTableBleed({ paneWidth: 900, padLeft: 24, padRight: 24, fullWidth: false });
    const wide = computeTableBleed({ paneWidth: 1400, padLeft: 24, padRight: 24, fullWidth: false });
    expect(narrow).toBeGreaterThanOrEqual(0);
    expect(wide).toBeGreaterThan(narrow);
    expect(wide).toBe(Math.round((1400 - 48 - CONTENT_COLUMN_WIDTH) / 2) + EDITOR_GUTTER);
  });

  it("寸法が取れない初期描画では 0（張り出さない）", () => {
    expect(computeTableBleed({ paneWidth: 0, padLeft: 24, padRight: 24, fullWidth: false })).toBe(0);
    expect(computeTableBleed({ paneWidth: NaN, padLeft: 24, padRight: 24, fullWidth: false })).toBe(0);
  });
});
