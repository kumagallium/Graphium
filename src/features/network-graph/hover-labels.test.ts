import { describe, it, expect } from "vitest";
import { estimateLabelWidth, pickHoverLabels, type LabelCandidate } from "./hover-labels";

const c = (id: string, x: number, y: number, text = "題名"): LabelCandidate => ({ id, x, y, r: 4, text });
const opts = { max: 12, fontPx: 11, anchorFontPx: 13 };

describe("ホバーで題を出す相手の選び方", () => {
  it("離れた相手は全部出し、ホバー中のノードの題とぶつかる相手は出さない", () => {
    const anchor = c("a", 100, 100, "ホバー中のノート");
    const picked = pickHoverLabels(anchor, [c("near", 102, 104), c("far1", 400, 100), c("far2", 100, 400)], opts);
    expect(picked).toEqual(["far1", "far2"]);
  });

  it("互いにぶつかる相手は先に並んだ方（大きい方）だけ", () => {
    const anchor = c("a", 0, 0);
    const picked = pickHoverLabels(anchor, [c("big", 300, 300), c("small", 305, 302)], opts);
    expect(picked).toEqual(["big"]);
  });

  it("上限を超えない", () => {
    const anchor = c("a", 0, 0);
    const many = Array.from({ length: 30 }, (_, i) => c(`n${i}`, 200 * (i + 1), 0));
    expect(pickHoverLabels(anchor, many, { ...opts, max: 5 })).toHaveLength(5);
  });

  it("幅の見積もりは全角を半角より広く取る", () => {
    expect(estimateLabelWidth("あいう", 10)).toBe(30);
    expect(estimateLabelWidth("abc", 10)).toBeCloseTo(18);
  });
});
