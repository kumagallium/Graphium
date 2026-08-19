import { describe, it, expect } from "vitest";
import { collectLabelVocabulary, isVocabularyEmpty } from "./label-vocabulary";
import type { NoteIndexEntry } from "../navigation/index-file";

function note(partial: Partial<NoteIndexEntry>): NoteIndexEntry {
  return {
    noteId: "n1",
    title: "note",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...partial,
  } as NoteIndexEntry;
}

const inline = (label: string, text: string, i = 0) => ({
  blockId: `b${i}`,
  label: label as "material" | "tool" | "attribute" | "output",
  text,
  entityId: `ent_${label}_${i}`,
});

describe("collectLabelVocabulary", () => {
  it("種類ごとにラベルを集める", () => {
    const v = collectLabelVocabulary([
      note({
        steps: [{ blockId: "s1", text: "Ball milling" }],
        inlineLabels: [
          inline("material", "Cu", 1),
          inline("tool", "プラネタリーボールミル", 2),
          inline("output", "熱電特性データ", 3),
        ],
      }),
    ]);
    expect(v.step).toEqual(["Ball milling"]);
    expect(v.material).toEqual(["Cu"]);
    expect(v.tool).toEqual(["プラネタリーボールミル"]);
    expect(v.output).toEqual(["熱電特性データ"]);
  });

  it("パラメータはキーだけを集める（値は語彙ではない）", () => {
    const v = collectLabelVocabulary([
      note({
        inlineLabels: [
          inline("attribute", "rpm: 300", 1),
          inline("attribute", "rpm: 500", 2),
          inline("attribute", "temperature: 823 K", 3),
          inline("attribute", "99.999%", 4), // キー無しは捨てる
        ],
      }),
    ]);
    expect(v.attributeKey).toEqual(["rpm", "temperature"]);
  });

  it("頻出順に並べ、表記揺れは大文字小文字を無視して束ねる", () => {
    const v = collectLabelVocabulary([
      note({
        inlineLabels: [
          inline("tool", "XRD", 1),
          inline("tool", "xrd", 2),
          inline("tool", "SEM", 3),
        ],
      }),
    ]);
    expect(v.tool).toEqual(["XRD", "SEM"]);
  });

  it("ゴミ箱・アーカイブのノートは数えない", () => {
    const v = collectLabelVocabulary([
      note({ noteId: "a", deletedAt: "2026-01-02T00:00:00.000Z", inlineLabels: [inline("tool", "捨てた道具", 1)] }),
      note({ noteId: "b", archivedAt: "2026-01-02T00:00:00.000Z", inlineLabels: [inline("tool", "しまった道具", 2)] }),
      note({ noteId: "c", inlineLabels: [inline("tool", "生きてる道具", 3)] }),
    ]);
    expect(v.tool).toEqual(["生きてる道具"]);
  });

  it("散文の断片（長すぎる text）や記号だけの text はラベルにしない", () => {
    const v = collectLabelVocabulary([
      note({
        inlineLabels: [
          inline("material", "a".repeat(60), 1),
          inline("material", "———", 2),
          inline("material", "Te", 3),
        ],
      }),
    ]);
    expect(v.material).toEqual(["Te"]);
  });

  it("件数が多くても種類ごとの上限で切る", () => {
    const many = Array.from({ length: 200 }, (_, i) => inline("material", `mat-${i}`, i));
    const v = collectLabelVocabulary([note({ inlineLabels: many })]);
    expect(v.material).toHaveLength(40);
  });

  it("空のインデックスでは空の語彙を返す", () => {
    expect(isVocabularyEmpty(collectLabelVocabulary([]))).toBe(true);
    expect(isVocabularyEmpty(collectLabelVocabulary(null))).toBe(true);
  });
});
