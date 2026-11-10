import { describe, expect, it } from "vitest";
import { compareKindLabels, kindSortLabel, type KindSortEntry } from "./wiki-list-kind-sort";

// ラベルはキーの末尾をそのまま返す（並びを読みやすくするため日本語風の値を当てる）
const LABELS: Record<string, string> = {
  "wikiTypes.topicType.concept": "概念",
  "wikiTypes.topicType.method": "手法・装置",
  "wikiTypes.topicType.material": "物質・材料",
  "wikiTypes.claimRole.finding": "発見",
  "wikiTypes.claimRole.method": "手法",
};
const t = (key: string) => LABELS[key] ?? key;

function sortBy(entries: (KindSortEntry & { id: string })[], kind: string, dir: "asc" | "desc") {
  return [...entries]
    .sort((a, b) => compareKindLabels(kindSortLabel(a, kind, t), kindSortLabel(b, kind, t), dir, "ja"))
    .map((e) => e.id);
}

describe("種別列の並べ替え", () => {
  it("トピックは topicType のラベルでまとまる（以前は全行同値で並ばなかった）", () => {
    const entries = [
      { id: "a", topicType: "method" },
      { id: "b", topicType: "concept" },
      { id: "c" },
      { id: "d", topicType: "method" },
      { id: "e", topicType: "concept" },
    ];
    const asc = sortBy(entries, "topic", "asc");
    // 同じ種類が連続し、未分類は最後
    expect(asc.slice(0, 2).sort()).toEqual(["b", "e"]);
    expect(asc.slice(2, 4).sort()).toEqual(["a", "d"]);
    expect(asc[4]).toBe("c");
  });

  it("降順でも未分類は最後", () => {
    const entries = [{ id: "x" }, { id: "a", topicType: "concept" }, { id: "b", topicType: "method" }];
    const desc = sortBy(entries, "topic", "desc");
    expect(desc[desc.length - 1]).toBe("x");
    expect(desc.slice(0, 2)).toEqual([...sortBy(entries, "topic", "asc").slice(0, 2)].reverse());
  });

  it("知見は claimRole のラベルで比べ、役割の無い行は最後", () => {
    const entries = [
      { id: "none", claimRole: [] },
      { id: "m", claimRole: ["method"] },
      { id: "f", claimRole: ["finding"] },
      { id: "fm", claimRole: ["finding", "method"] },
    ];
    const asc = sortBy(entries, "claim", "asc");
    expect(asc[asc.length - 1]).toBe("none");
    // 先頭の役割が同じもの（f と fm）は隣り合う
    expect(Math.abs(asc.indexOf("f") - asc.indexOf("fm"))).toBe(1);
  });

  it("要約・問答は種類を持たない", () => {
    expect(kindSortLabel({ topicType: "concept" }, "summary", t)).toBeUndefined();
    expect(kindSortLabel({}, "answer", t)).toBeUndefined();
  });
});
