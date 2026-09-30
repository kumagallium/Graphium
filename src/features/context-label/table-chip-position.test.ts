// テーブルのラベルチップの横位置（B-5 / C-6 / E-2）
import { describe, it, expect } from "vitest";
import {
  resolveTableChipPlacement,
  resolveTableChipRight,
  TABLE_CHIP_CAPTION_GAP,
  TABLE_CHIP_STACK_OFFSET,
} from "./table-chip-position";

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

// ステップのカードの中の狭い表で、チップが入れ物の右の罫線を越える（RB-2 / RE-2）
describe("resolveTableChipPlacement", () => {
  it("入れ物の内側に収まるなら今までと同じ位置・同じ段（右隣へ押し出すだけ）", () => {
    const p = resolveTableChipPlacement({
      tableLeft: 382,
      tableRight: 503,
      captionWidth: 59,
      chipWidth: 96,
      maxRight: 700,
    });
    expect(p).toEqual({ right: 382 + 59 + TABLE_CHIP_CAPTION_GAP + 96, stacked: false });
  });

  it("広い表（押し出しが起きない）は上限に関係なく表の右端のまま", () => {
    expect(
      resolveTableChipPlacement({
        tableLeft: 382,
        tableRight: 701,
        captionWidth: 59,
        chipWidth: 84,
        maxRight: 500,
      })
    ).toEqual({ right: 701, stacked: false });
  });

  it("上限が無い（取れない）ときは今までと同じ", () => {
    const input = { tableLeft: 382, tableRight: 451, captionWidth: 57, chipWidth: 84 };
    expect(resolveTableChipPlacement({ ...input, maxRight: null })).toEqual({
      right: resolveTableChipRight(input),
      stacked: false,
    });
    expect(resolveTableChipPlacement(input).stacked).toBe(false);
  });

  it("押し出した右端がカードの右端を超えるときは、名前の行の上（2 段目）へ積む", () => {
    // 1024×528 の点検値: 表 382〜451（幅 69）、名前の行 57、チップ 84、カードの内側の右端 ≒ 477
    const input = { tableLeft: 382, tableRight: 451, captionWidth: 57, chipWidth: 84 };
    const pushed = resolveTableChipRight(input);
    expect(pushed).toBeGreaterThan(477);
    const p = resolveTableChipPlacement({ ...input, maxRight: 477 });
    expect(p.stacked).toBe(true);
    // 右端は入れ物の内側。表の左端からチップ 1 つ分は右（表の左へはみ出さない）
    expect(p.right).toBeLessThanOrEqual(477);
    expect(p.right - 84).toBeGreaterThanOrEqual(382);
  });

  it("2 段目でも表の右端に右揃え（表がチップより広ければ表の右端）", () => {
    // 表が 100px でチップ 84px。名前の行 70px で右隣には置けない（382+70+6+84=542 > 上限 500）
    const p = resolveTableChipPlacement({
      tableLeft: 382,
      tableRight: 482,
      captionWidth: 70,
      chipWidth: 84,
      maxRight: 500,
    });
    expect(p).toEqual({ right: 482, stacked: true });
  });

  it("カードがチップより狭いときは入れ物の右端が勝つ", () => {
    const p = resolveTableChipPlacement({
      tableLeft: 382,
      tableRight: 420,
      captionWidth: 57,
      chipWidth: 84,
      maxRight: 440,
    });
    expect(p).toEqual({ right: 440, stacked: true });
  });

  it("2 段目の持ち上げ量は、表の上余白の予約（名前の行 1 行分 26px）と同じ", () => {
    expect(TABLE_CHIP_STACK_OFFSET).toBe(26);
  });
});
