// responsive-columns（狭いとき隠す列の判定）のテスト
import { describe, expect, it } from "vitest";
import {
  SCROLLBAR_SLACK,
  requiredWidth,
  resolveHiddenCount,
  tableMinWidth,
  type ColumnPlan,
} from "./responsive-columns";

const PLAN: ColumnPlan = {
  baseWidth: 400,
  hideable: [
    { key: "a", width: 100 },
    { key: "b", width: 50 },
    { key: "c", width: 30 },
  ],
};

describe("requiredWidth", () => {
  it("隠す数が増えるほど、必要な幅は隠した列の幅だけ減る", () => {
    expect(requiredWidth(PLAN, 0)).toBe(400 + 180 + SCROLLBAR_SLACK);
    expect(requiredWidth(PLAN, 1)).toBe(400 + 80 + SCROLLBAR_SLACK);
    expect(requiredWidth(PLAN, 2)).toBe(400 + 30 + SCROLLBAR_SLACK);
    expect(requiredWidth(PLAN, 3)).toBe(400 + SCROLLBAR_SLACK);
  });
});

describe("resolveHiddenCount", () => {
  it("十分広ければ何も隠さない", () => {
    expect(resolveHiddenCount(requiredWidth(PLAN, 0), PLAN)).toBe(0);
    expect(resolveHiddenCount(2000, PLAN)).toBe(0);
  });

  it("境目の 1px 手前で 1 列隠し、境目ちょうどでは隠さない", () => {
    const edge = requiredWidth(PLAN, 0);
    expect(resolveHiddenCount(edge, PLAN)).toBe(0);
    expect(resolveHiddenCount(edge - 1, PLAN)).toBe(1);
  });

  it("狭くなるほど先頭の列から順に隠す", () => {
    expect(resolveHiddenCount(requiredWidth(PLAN, 1), PLAN)).toBe(1);
    expect(resolveHiddenCount(requiredWidth(PLAN, 1) - 1, PLAN)).toBe(2);
    expect(resolveHiddenCount(requiredWidth(PLAN, 2) - 1, PLAN)).toBe(3);
  });

  it("全部隠してもなお足りないときは全部隠す（あとは横スクロール）", () => {
    expect(resolveHiddenCount(100, PLAN)).toBe(3);
  });

  it("幅が測れていない（0・負・NaN）ときは隠さない", () => {
    expect(resolveHiddenCount(0, PLAN)).toBe(0);
    expect(resolveHiddenCount(-5, PLAN)).toBe(0);
    expect(resolveHiddenCount(Number.NaN, PLAN)).toBe(0);
  });

  it("隠せる列が無い表は常に 0", () => {
    expect(resolveHiddenCount(10, { baseWidth: 300, hideable: [] })).toBe(0);
  });
});

describe("tableMinWidth", () => {
  it("隠せる列を全部隠した幅（= 隠さない列の合計）", () => {
    expect(tableMinWidth(PLAN)).toBe(400);
  });
});
