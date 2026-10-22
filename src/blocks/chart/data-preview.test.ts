import { describe, it, expect } from "vitest";
import { analyzeDataText } from "./data-preview";

describe("analyzeDataText", () => {
  it("カンマ CSV: 数値列と線を返す", () => {
    const r = analyzeDataText("時刻,温度,湿度\n08:00,24.5,60\n09:00,25.1,62\n10:00,26.0,63\n");
    expect(r.headers).toEqual(["時刻", "温度", "湿度"]);
    expect(r.rowCount).toBe(3);
    expect(r.numericColumns).toEqual(expect.arrayContaining(["温度", "湿度"]));
    expect(r.sparkline).toEqual([24.5, 25.1, 26.0]);
    expect(r.usable).toBe(true);
  });

  it("前置きメタ付きの空白区切り .txt を読める", () => {
    const text = [
      "# Instrument: oven",
      "# Date: 2026-10-01",
      "time temp",
      "0 20",
      "10 80",
      "20 150",
      "30 200",
    ].join("\n");
    const r = analyzeDataText(text);
    expect(r.usable).toBe(true);
    expect(r.rowCount).toBeGreaterThanOrEqual(4);
    expect(r.sparkline.length).toBeGreaterThanOrEqual(2);
  });

  it("数値列が無いログ風テキストは usable=false", () => {
    const r = analyzeDataText("started\nmixing done\nproofing finished\nbaked\n");
    expect(r.numericColumns).toEqual([]);
    expect(r.sparkline).toEqual([]);
    expect(r.usable).toBe(false);
  });

  it("空文字でも落ちない", () => {
    const r = analyzeDataText("");
    expect(r.usable).toBe(false);
    expect(r.sparkline).toEqual([]);
  });

  it("48 点を超える列は端点を含めて間引く", () => {
    const rows = Array.from({ length: 200 }, (_, i) => `${i},${i * 2}`);
    const r = analyzeDataText(["x,y", ...rows].join("\n"));
    expect(r.rowCount).toBe(200);
    expect(r.sparkline).toHaveLength(48);
    expect(r.sparkline[0]).toBe(0);
    expect(r.sparkline[47]).toBe(398);
  });

  it("256 KB を超える本文は先頭だけで判定し、行数は残りの改行数で近似する", () => {
    const total = 60000;
    const rows = Array.from({ length: total }, (_, i) => `${i},${i * 2},abcdefghij`);
    const text = ["x,y,z", ...rows].join("\n");
    expect(text.length).toBeGreaterThan(256 * 1024);
    const r = analyzeDataText(text);
    expect(r.usable).toBe(true);
    expect(r.headers).toEqual(["x", "y", "z"]);
    expect(Math.abs(r.rowCount - total)).toBeLessThanOrEqual(2);
    expect(r.sparkline).toHaveLength(48);
    // 判定に使ったのは先頭部分だけ（最後の値は全体の末尾より小さい）
    expect(r.sparkline[47]).toBeLessThan((total - 1) * 2);
  });
});
