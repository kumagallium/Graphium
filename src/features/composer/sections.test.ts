import { describe, expect, it } from "vitest";
import { EXPANDED_LIMIT, sliceSection } from "./sections";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("sliceSection", () => {
  it("上限以内なら全件で more は 0", () => {
    expect(sliceSection(range(3), 5, false)).toEqual({ visible: [0, 1, 2], more: 0, hidden: false });
    expect(sliceSection(range(5), 5, false).more).toBe(0);
  });
  it("上限を超えたら切って残りの件数を返す", () => {
    const r = sliceSection(range(12), 5, false);
    expect(r.visible).toEqual([0, 1, 2, 3, 4]);
    expect(r.more).toBe(7);
  });
  it("展開すると上限が EXPANDED_LIMIT に広がり more は 0", () => {
    const r = sliceSection(range(30), 5, true);
    expect(r.visible).toHaveLength(30);
    expect(r.more).toBe(0);
  });
  it("展開しても EXPANDED_LIMIT を超える分は出さない", () => {
    const r = sliceSection(range(200), 5, true);
    expect(r.visible).toHaveLength(EXPANDED_LIMIT);
    expect(r.more).toBe(0);
  });
  it("EXPANDED_LIMIT を超える段は未展開の more が増える分だけ、展開後は hidden", () => {
    const folded = sliceSection(range(100), 8, false);
    expect(folded.more).toBe(EXPANDED_LIMIT - 8);
    expect(folded.hidden).toBe(true);
    const open = sliceSection(range(100), 8, true);
    expect(open.visible).toHaveLength(EXPANDED_LIMIT);
    expect(open.hidden).toBe(true);
    expect(sliceSection(range(EXPANDED_LIMIT), 8, true).hidden).toBe(false);
  });
  it("空配列は空", () => {
    expect(sliceSection([], 4, false)).toEqual({ visible: [], more: 0, hidden: false });
  });
});
