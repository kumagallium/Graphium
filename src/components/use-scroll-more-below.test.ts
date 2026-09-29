import { describe, it, expect } from "vitest";
import { hasMoreBelow, MORE_BELOW_THRESHOLD } from "./use-scroll-more-below";

describe("hasMoreBelow", () => {
  it("スクロールできない（中身が枠に収まる）なら false", () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 })).toBe(false);
  });

  it("先頭にいて下に続きがあれば true（853x440 相当: 枠 299・中身 840）", () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 299, scrollHeight: 840 })).toBe(true);
  });

  it("途中までスクロールしてもまだ続きがあれば true", () => {
    expect(hasMoreBelow({ scrollTop: 300, clientHeight: 299, scrollHeight: 840 })).toBe(true);
  });

  it("一番下までスクロールしたら false", () => {
    expect(hasMoreBelow({ scrollTop: 541, clientHeight: 299, scrollHeight: 840 })).toBe(false);
  });

  it("サブピクセルの丸め（残り 1px 未満〜しきい値以内）では一番下とみなす", () => {
    expect(hasMoreBelow({ scrollTop: 540.4, clientHeight: 299, scrollHeight: 840 })).toBe(false);
    expect(
      hasMoreBelow({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 + MORE_BELOW_THRESHOLD }),
    ).toBe(false);
    expect(
      hasMoreBelow({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 + MORE_BELOW_THRESHOLD + 1 }),
    ).toBe(true);
  });
});
