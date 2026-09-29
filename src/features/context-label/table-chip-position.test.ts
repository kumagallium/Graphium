// テーブルのラベルチップの横位置（B-5 / C-6 / E-2）
import { describe, it, expect } from "vitest";
import { resolveTableChipRight, TABLE_CHIP_CAPTION_GAP } from "./table-chip-position";

describe("resolveTableChipRight", () => {
  it("表が十分広いときは表の右端のまま（右揃えの意図を保つ）", () => {
    // 表 2（幅 319px）: 名前の行 59px + 隙間 + チップ 84px は表の中に収まる
    expect(
      resolveTableChipRight({
        tableLeft: 382,
        tableRight: 701,
        captionWidth: 59,
        chipWidth: 84,
      })
    ).toBe(701);
  });

  it("狭い表（幅 121px・チップ 96px）では名前の行の右隣まで押し出す", () => {
    // 点検で見つけた表 4: 表は 382〜503。名前の行 59px と重なっていた
    const right = resolveTableChipRight({
      tableLeft: 382,
      tableRight: 503,
      captionWidth: 59,
      chipWidth: 96,
    });
    expect(right).toBe(382 + 59 + TABLE_CHIP_CAPTION_GAP + 96);
    // チップの左端（右端 - 幅）が名前の行の右端より右にある
    expect(right - 96).toBeGreaterThanOrEqual(382 + 59);
  });

  it("ちょうど収まる境界では表の右端のまま", () => {
    const tableLeft = 100;
    const captionWidth = 60;
    const chipWidth = 80;
    const edge = tableLeft + captionWidth + TABLE_CHIP_CAPTION_GAP + chipWidth;
    expect(
      resolveTableChipRight({ tableLeft, tableRight: edge, captionWidth, chipWidth })
    ).toBe(edge);
    expect(
      resolveTableChipRight({ tableLeft, tableRight: edge - 1, captionWidth, chipWidth })
    ).toBe(edge);
  });

  it("名前の行の幅が取れないときは今の位置（表の右端）", () => {
    expect(
      resolveTableChipRight({ tableLeft: 0, tableRight: 100, captionWidth: null, chipWidth: 96 })
    ).toBe(100);
    expect(
      resolveTableChipRight({ tableLeft: 0, tableRight: 100, captionWidth: 0, chipWidth: 96 })
    ).toBe(100);
  });

  it("チップの幅が取れないときは今の位置（表の右端）", () => {
    expect(
      resolveTableChipRight({ tableLeft: 0, tableRight: 100, captionWidth: 59, chipWidth: null })
    ).toBe(100);
    expect(
      resolveTableChipRight({ tableLeft: 0, tableRight: 100, captionWidth: 59, chipWidth: NaN })
    ).toBe(100);
  });

  it("隙間は指定できる", () => {
    expect(
      resolveTableChipRight({
        tableLeft: 0,
        tableRight: 50,
        captionWidth: 40,
        chipWidth: 40,
        gap: 10,
      })
    ).toBe(90);
  });
});
