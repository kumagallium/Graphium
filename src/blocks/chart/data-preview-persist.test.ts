// data-preview-persist: 保存形式の往復・版違い・壊れた保存
import { describe, expect, it } from "vitest";
import { analyzeDataText } from "./data-preview";
import { PREVIEW_FORMAT, parseStoredPreview, serializePreview } from "./data-preview-persist";

const CSV = "hour,temp,humidity\n" + Array.from({ length: 30 }, (_, h) => `${h},${(26 + Math.sin(h / 4) * 3).toFixed(3)},${60 + (h % 7)}`).join("\n");

describe("data-preview-persist", () => {
  it("保存して読み戻すと、列名・行数・判定はそのまま、線の点は 6 桁に丸めて戻る", () => {
    const p = analyzeDataText(CSV);
    const back = parseStoredPreview(serializePreview(p));
    expect(back).not.toBeNull();
    expect(back!.headers).toEqual(p.headers);
    expect(back!.rowCount).toBe(p.rowCount);
    expect(back!.numericColumns).toEqual(p.numericColumns);
    expect(back!.usable).toBe(true);
    expect(back!.sparkline.map((s) => s.column)).toEqual(p.sparkline.map((s) => s.column));
    back!.sparkline.forEach((s, i) =>
      s.points.forEach((pt, j) => expect(pt.y).toBeCloseTo(p.sparkline[i].points[j].y, 4)),
    );
  });

  it("版の違う保存は読み捨てる（計算し直す）", () => {
    const stored = JSON.parse(serializePreview(analyzeDataText(CSV)));
    stored.format = PREVIEW_FORMAT + 1;
    expect(parseStoredPreview(JSON.stringify(stored))).toBeNull();
  });

  it("壊れた保存・形の崩れた保存は null", () => {
    expect(parseStoredPreview(undefined)).toBeNull();
    expect(parseStoredPreview("not json")).toBeNull();
    expect(parseStoredPreview(JSON.stringify({ format: PREVIEW_FORMAT }))).toBeNull();
    const stored = JSON.parse(serializePreview(analyzeDataText(CSV)));
    stored.preview.sparkline[0].points[0].x = "a";
    expect(parseStoredPreview(JSON.stringify(stored))).toBeNull();
  });
});
