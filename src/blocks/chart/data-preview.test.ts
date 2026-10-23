import { describe, it, expect } from "vitest";
import { analyzeDataText, analyzeDataTextAsync } from "./data-preview";

describe("analyzeDataText", () => {
  it("カンマ CSV: 数値列と線を返す", () => {
    const r = analyzeDataText("時刻,温度,湿度\n08:00,24.5,60\n09:00,25.1,62\n10:00,26.0,63\n");
    expect(r.headers).toEqual(["時刻", "温度", "湿度"]);
    expect(r.rowCount).toBe(3);
    expect(r.numericColumns).toEqual(expect.arrayContaining(["温度", "湿度"]));
    expect(r.sparkline.map((p) => p.y)).toEqual([24.5, 25.1, 26.0]);
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
    // 区間ごとに最小・最大を残すので 48〜96 点。両端は残る
    expect(r.sparkline.length).toBeGreaterThan(48);
    expect(r.sparkline.length).toBeLessThanOrEqual(96);
    expect(r.sparkline[0]).toEqual({ x: 0, y: 0 });
    expect(r.sparkline[r.sparkline.length - 1]).toEqual({ x: 199, y: 398 });
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
    // 線は本文全体から取る（末尾まで描かれる）
    expect(r.sparkline[r.sparkline.length - 1].y).toBe((total - 1) * 2);
  });

  it("鋭いピークが間引きで消えない", () => {
    const peaks = new Map([[500, 90], [1700, 120], [3001, 100]]);
    const rows: string[] = [];
    for (let i = 0; i < 3500; i++) {
      const base = 10 + Math.sin(i / 300);
      const y = peaks.get(i) ?? (peaks.has(i - 1) ? base + 40 : base);
      rows.push(`${(10 + i * 0.02).toFixed(2)} ${y}`);
    }
    const r = analyzeDataText(["tt cps", ...rows].join("\n"));
    expect(Math.max(...r.sparkline.map((p) => p.y))).toBe(120);
    for (const i of [500, 1700, 3001]) {
      const x = 10 + i * 0.02;
      expect(r.sparkline.some((p) => Math.abs(p.x - x) < 1e-6 && p.y > 50)).toBe(true);
    }
  });

  it("測定間隔が不揃いでも x は実際の X 値", () => {
    const r = analyzeDataText("t,v\n0,1\n1,2\n2,3\n3,4\n50,5\n100,6\n");
    expect(r.sparkline.map((p) => p.x)).toEqual([0, 1, 2, 3, 50, 100]);
  });

  it("X が降順でも返る点は x 昇順", () => {
    const r = analyzeDataText("t,v\n5,1\n4,2\n3,3\n2,4\n1,5\n");
    expect(r.sparkline.map((p) => p.x)).toEqual([1, 2, 3, 4, 5]);
    expect(r.sparkline.map((p) => p.y)).toEqual([5, 4, 3, 2, 1]);
  });

  it("X が一部だけ読めない行は線から外し、行番号と混ぜない", () => {
    const r = analyzeDataText("t,v\n10,1\n20,2\n-,9\n30,3\n40,4\n");
    expect(r.sparkline.map((p) => p.x)).toEqual([10, 20, 30, 40]);
    expect(r.sparkline.map((p) => p.y)).toEqual([1, 2, 3, 4]);
  });

  it("先頭列が数値でも日時でもなければ x は行番号", () => {
    const r = analyzeDataText("label,v\nalpha,1\nbeta,2\ngamma,3\n");
    expect(r.sparkline.map((p) => p.x)).toEqual([0, 1, 2]);
  });

  it("先頭列が日時なら x は時刻", () => {
    const r = analyzeDataText("date,v\n2026-10-01,1\n2026-10-02,2\n2026-10-04,3\n");
    const xs = r.sparkline.map((p) => p.x);
    expect(xs[1] - xs[0]).toBe(86400000);
    expect(xs[2] - xs[1]).toBe(2 * 86400000);
  });

  describe("300 KB を超えるファイル", () => {
    const total = 40000;
    const rows = Array.from({ length: total }, (_, i) => {
      const y = i === total - 3 ? 9999 : i % 50;
      return `${i} ${y} abcdefghijklmnop`;
    });
    const text = ["x y z", ...rows].join("\n") + "\n";

    it("同期版: 末尾の大きな値まで線に入り、行数が一致する", () => {
      expect(text.length).toBeGreaterThan(300 * 1024);
      const r = analyzeDataText(text);
      expect(r.rowCount).toBe(total);
      expect(Math.max(...r.sparkline.map((p) => p.y))).toBe(9999);
      expect(r.sparkline[r.sparkline.length - 1].x).toBeGreaterThan(total - 1000);
    });

    it("非同期版でも同じ結果", async () => {
      expect(await analyzeDataTextAsync(text)).toEqual(analyzeDataText(text));
    });
  });
});
