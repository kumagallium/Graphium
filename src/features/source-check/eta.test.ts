// 照合の残り時間の目安のテスト
import { describe, expect, it } from "vitest";
import { ETA_MIN_DONE, estimateRemainingMs, remainingMinutes } from "./eta";

describe("estimateRemainingMs", () => {
  it("終えた件数が少ないうちは出さない", () => {
    expect(estimateRemainingMs(0, ETA_MIN_DONE - 1, 100, 60_000)).toBeNull();
    expect(estimateRemainingMs(0, 0, 100, 60_000)).toBeNull();
  });

  it("経過を終えた件数で割って残りに掛ける", () => {
    // 3 件に 30 秒 → 1 件 10 秒 → 残り 97 件で 970 秒
    expect(estimateRemainingMs(0, 3, 100, 30_000)).toBe(970_000);
  });

  it("全部終わった・総数 0・経過 0 のときは出さない", () => {
    expect(estimateRemainingMs(0, 100, 100, 60_000)).toBeNull();
    expect(estimateRemainingMs(0, 3, 0, 60_000)).toBeNull();
    expect(estimateRemainingMs(60_000, 3, 100, 60_000)).toBeNull();
  });
});

describe("remainingMinutes", () => {
  it("分に切り上げ、1 分未満は 0", () => {
    expect(remainingMinutes(970_000)).toBe(17);
    expect(remainingMinutes(60_000)).toBe(1);
    expect(remainingMinutes(30_000)).toBe(1);
    expect(remainingMinutes(0)).toBe(0);
  });
});
