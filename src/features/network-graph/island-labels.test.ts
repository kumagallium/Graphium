// island-labels.tsx の純関数の検証: 名前の幅の見積もりと、重なった名前の除去。

import { describe, expect, it } from "vitest";
import { dropOverlappingLabels, estimateLabelWidth } from "./island-labels";

describe("estimateLabelWidth", () => {
  it("全角は半角より広く、上限で頭打ちになる", () => {
    expect(estimateLabelWidth("発酵")).toBeGreaterThan(estimateLabelWidth("ab"));
    expect(estimateLabelWidth("あ".repeat(100))).toBe(220);
  });
});

describe("dropOverlappingLabels", () => {
  it("先に置いた名前と重なる名前は出さない（並び順が優先）", () => {
    const kept = dropOverlappingLabels([
      { text: "大きい島", x: 100, y: 100 },
      { text: "小さい島", x: 110, y: 105 },
      { text: "離れた島", x: 400, y: 100 },
    ]);
    expect(kept.map((l) => l.text)).toEqual(["大きい島", "離れた島"]);
  });

  it("below の見出しは y から下に広がる（島の名前のすぐ下に置いても重ならない）", () => {
    const kept = dropOverlappingLabels([
      { text: "島の名前", x: 100, y: 100 },
      { text: "見出し", x: 100, y: 110, below: true },
    ]);
    expect(kept).toHaveLength(2);
  });

  it("上下に十分離れていれば両方残す", () => {
    const kept = dropOverlappingLabels([
      { text: "上", x: 100, y: 100 },
      { text: "下", x: 100, y: 140 },
    ]);
    expect(kept).toHaveLength(2);
  });
});
