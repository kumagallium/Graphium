import { describe, expect, it } from "vitest";
import {
  normalizeStoredSourceDate,
  parseSourceDate,
  sourceDatePrecision,
  sourceDateSortKey,
} from "./source-date";

describe("parseSourceDate", () => {
  it("分かっている桁までを保存形にする", () => {
    expect(parseSourceDate("2012")).toBe("2012");
    expect(parseSourceDate("2012-3")).toBe("2012-03");
    expect(parseSourceDate("2012-03-05")).toBe("2012-03-05");
    expect(parseSourceDate("2012/3/5")).toBe("2012-03-05");
    expect(parseSourceDate("2012.03")).toBe("2012-03");
  });

  it("日本語の年月日を読む", () => {
    expect(parseSourceDate("2012年")).toBe("2012");
    expect(parseSourceDate("2012年3月")).toBe("2012-03");
    expect(parseSourceDate("2012年3月5日")).toBe("2012-03-05");
    expect(parseSourceDate("２０１２年３月")).toBe("2012-03");
  });

  it("時刻付きの ISO は日付だけを使う（タイムゾーンで日をずらさない）", () => {
    expect(parseSourceDate("2012-03-05T23:30:00Z")).toBe("2012-03-05");
    expect(parseSourceDate("2012-03-05T01:00:00+09:00")).toBe("2012-03-05");
  });

  it("あり得ない日付・読めない書き方は null", () => {
    expect(parseSourceDate("")).toBeNull();
    expect(parseSourceDate("  ")).toBeNull();
    expect(parseSourceDate("2012-13")).toBeNull();
    expect(parseSourceDate("2013-02-29")).toBeNull();
    expect(parseSourceDate("March 2012")).toBeNull();
    expect(parseSourceDate("12")).toBeNull();
    expect(parseSourceDate(undefined)).toBeNull();
  });

  it("うるう年の 2/29 は通す", () => {
    expect(parseSourceDate("2012-02-29")).toBe("2012-02-29");
  });
});

describe("normalizeStoredSourceDate", () => {
  it("保存形だけを通す", () => {
    expect(normalizeStoredSourceDate("2012-03")).toBe("2012-03");
    expect(normalizeStoredSourceDate("2012/03")).toBeUndefined();
    expect(normalizeStoredSourceDate("2012-3")).toBeUndefined();
    expect(normalizeStoredSourceDate(2012)).toBeUndefined();
    expect(normalizeStoredSourceDate("2012-02-30")).toBeUndefined();
  });
});

describe("sourceDatePrecision", () => {
  it("桁で精度を返す", () => {
    expect(sourceDatePrecision("2012")).toBe("year");
    expect(sourceDatePrecision("2012-03")).toBe("month");
    expect(sourceDatePrecision("2012-03-05")).toBe("day");
  });
});

describe("sourceDateSortKey", () => {
  it("資料の日付が無ければ作成日で補い、時系列の順に並ぶ", () => {
    const rows = [
      { id: "blog", sourceDate: "2026-11-01", createdAt: "2026-11-22T01:00:00.000Z" },
      { id: "own", createdAt: "2026-11-20T09:00:00.000Z" },
      { id: "paper-year", sourceDate: "2012", createdAt: "2026-11-22T01:00:00.000Z" },
      { id: "paper-month", sourceDate: "2012-03", createdAt: "2026-11-22T01:00:00.000Z" },
    ];
    const sorted = [...rows].sort((a, b) => sourceDateSortKey(a).localeCompare(sourceDateSortKey(b)));
    expect(sorted.map((r) => r.id)).toEqual(["paper-year", "paper-month", "blog", "own"]);
  });
});
