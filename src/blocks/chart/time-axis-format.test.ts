import { describe, expect, it } from "vitest";
import { formatFullDateTime, timeAxisLabelFormatter } from "./time-axis-format";

describe("timeAxisLabelFormatter", () => {
  it("日境界に月日を出す（日番号だけにしない）", () => {
    expect(timeAxisLabelFormatter("ja").day).toBe("{M}/{d}");
    expect(timeAxisLabelFormatter("en").day).toBe("{MMM} {d}");
  });

  it("月境界には年を添える", () => {
    expect(timeAxisLabelFormatter("ja").month).toContain("{yyyy}");
    expect(timeAxisLabelFormatter("en").month).toContain("{yyyy}");
  });

  it("時・分の目盛りは時刻表記", () => {
    const f = timeAxisLabelFormatter("ja");
    expect(f.hour).toBe("{HH}:{mm}");
    expect(f.minute).toBe("{HH}:{mm}");
  });

  it("粒度に揃わない目盛り（none）は日付まで出す", () => {
    expect(timeAxisLabelFormatter("ja").none).toContain("{d}");
    expect(timeAxisLabelFormatter("en").none).toContain("{dd}");
  });
});

describe("formatFullDateTime", () => {
  it("日時を年月日＋時分で出す", () => {
    const ms = new Date(2026, 7, 14, 9, 5).getTime();
    expect(formatFullDateTime(ms, "ja")).toBe("2026/8/14 09:05");
    expect(formatFullDateTime(ms, "en")).toBe("2026-08-14 09:05");
  });

  it("秒があれば秒まで出す", () => {
    const ms = new Date(2026, 7, 14, 9, 5, 30).getTime();
    expect(formatFullDateTime(ms, "ja")).toBe("2026/8/14 09:05:30");
  });

  it("00:00 ちょうど（日付だけのデータ）は時刻を出さない", () => {
    const ms = new Date(2026, 7, 14).getTime();
    expect(formatFullDateTime(ms, "ja")).toBe("2026/8/14");
    expect(formatFullDateTime(ms, "en")).toBe("2026-08-14");
  });

  it("読めない値は空文字", () => {
    expect(formatFullDateTime(Number.NaN, "ja")).toBe("");
  });
});
