import { describe, expect, it } from "vitest";
import {
  alignBySpelling,
  applyLabelMapping,
  canonicalLabelKey,
  collectBlockLabels,
  mergeMappings,
} from "./label-alignment";
import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary } from "./label-vocabulary";

const empty = (): ProvVocabulary => ({ step: [], material: [], tool: [], output: [], attributeKey: [] });

const blocks: ProvIngesterBlock[] = [
  { blockType: "heading", level: 2, role: "procedure", text: "Calcination", stepId: "calc" },
  {
    blockType: "paragraph",
    content: [
      { text: "The " },
      { text: "Fe2O3 powders", role: "material" },
      { text: " were heated in a " },
      { text: "Tube-Furnace", role: "tool" },
      { text: " at " },
      { text: "Temperature: 900 °C", role: "attribute" },
    ],
    children: [
      { blockType: "bulletListItem", content: [{ text: "BaFe₁₂O₁₉", role: "output" }] },
    ],
  },
];

describe("canonicalLabelKey", () => {
  it("大小・ハイフン・空白・複数形・下付き数字の違いを畳む", () => {
    expect(canonicalLabelKey("Ball-milling")).toBe(canonicalLabelKey("ball milling"));
    expect(canonicalLabelKey("Fe2O3 powders")).toBe(canonicalLabelKey("Fe2O3 powder"));
    expect(canonicalLabelKey("BaFe₁₂O₁₉")).toBe(canonicalLabelKey("BaFe12O19"));
    expect(canonicalLabelKey("tube furnace")).toBe(canonicalLabelKey("Tube-Furnace"));
  });

  it("違う組成は畳まない", () => {
    expect(canonicalLabelKey("BaFe12O19")).not.toBe(canonicalLabelKey("BaFe11.6Co0.2Ni0.2O19"));
    expect(canonicalLabelKey("Calcination")).not.toBe(canonicalLabelKey("Sintering"));
  });

  it("複数形の規則は数字を含む語・短い語・-ss を触らない", () => {
    expect(canonicalLabelKey("glass")).toBe("glass");
    expect(canonicalLabelKey("gas")).toBe("gas");
    expect(canonicalLabelKey("Bi2Te3s")).toBe("bi2te3s");
  });
});

describe("collectBlockLabels", () => {
  it("手順の見出し・span・パラメータのキーを種類ごとに集める", () => {
    const labels = collectBlockLabels(blocks);
    expect(labels.step).toEqual(["Calcination"]);
    expect(labels.material).toEqual(["Fe2O3 powders"]);
    expect(labels.tool).toEqual(["Tube-Furnace"]);
    expect(labels.output).toEqual(["BaFe₁₂O₁₉"]);
    expect(labels.attributeKey).toEqual(["Temperature"]);
  });
});

describe("alignBySpelling", () => {
  it("表記ゆれだけが違う名前を既存の表記に寄せ、寄らない名前は段 2 に回す", () => {
    const inventory = { ...empty(), step: ["calcination"], tool: ["tube furnace"], attributeKey: ["temperature"] };
    const { mapping, changes, unmatched } = alignBySpelling(collectBlockLabels(blocks), inventory);
    expect(mapping.step).toEqual({ Calcination: "calcination" });
    expect(mapping.tool).toEqual({ "Tube-Furnace": "tube furnace" });
    expect(mapping.attributeKey).toEqual({ Temperature: "temperature" });
    expect(changes.every((c) => c.via === "spelling")).toBe(true);
    expect(unmatched.material).toEqual(["Fe2O3 powders"]);
    expect(unmatched.step).toEqual([]);
  });

  it("既存と完全一致の名前は寄せも段 2 もしない", () => {
    const inventory = { ...empty(), step: ["Calcination"] };
    const { mapping, unmatched } = alignBySpelling(collectBlockLabels(blocks), inventory);
    expect(mapping.step).toBeUndefined();
    expect(unmatched.step).toEqual([]);
  });

  it("同じ抽出結果の中の揺れは先に出た表記に寄せる", () => {
    const labels = { ...empty(), material: ["BaCO3 powder", "BaCO3 powders"] };
    const { mapping, unmatched } = alignBySpelling(labels, empty());
    expect(mapping.material).toEqual({ "BaCO3 powders": "BaCO3 powder" });
    expect(unmatched.material).toEqual(["BaCO3 powder"]);
  });
});

describe("applyLabelMapping", () => {
  it("見出し・span を置き換え、パラメータは値を残してキーだけ置き換える", () => {
    const out = applyLabelMapping(blocks, {
      step: { Calcination: "仮焼" },
      material: { "Fe2O3 powders": "Fe2O3" },
      attributeKey: { Temperature: "temperature" },
      output: { "BaFe₁₂O₁₉": "BaFe12O19" },
    });
    expect(out[0].text).toBe("仮焼");
    const spans = out[1].content!;
    expect(spans[1].text).toBe("Fe2O3");
    expect(spans[1].role).toBe("material");
    expect(spans[3].text).toBe("Tube-Furnace");
    expect(spans[5].text).toBe("temperature: 900 °C");
    expect(out[1].children![0].content![0].text).toBe("BaFe12O19");
    // 元のブロックは書き換えない
    expect(blocks[0].text).toBe("Calcination");
  });

  it("役割の無い span（地の文）は同じ文字列でも置き換えない", () => {
    const out = applyLabelMapping(blocks, { material: { "The ": "X" } });
    expect(out[1].content![0].text).toBe("The ");
  });
});

describe("受け渡しの名前", () => {
  it("成果物と次の手順の材料が同じ名前なら、片方だけの寄せでも両方を同じ名前にする", () => {
    const handoff: ProvIngesterBlock[] = [
      { blockType: "heading", level: 2, role: "procedure", text: "Mixing", stepId: "mix" },
      { blockType: "paragraph", content: [{ text: "mixed powder", role: "output" }] },
      { blockType: "heading", level: 2, role: "procedure", text: "Calcining", stepId: "calc" },
      { blockType: "paragraph", content: [{ text: "mixed powder", role: "material", derivedFrom: "mix" }] },
    ];
    const out = applyLabelMapping(handoff, { material: { "mixed powder": "mixed sample" } });
    expect(out[1].content![0].text).toBe("mixed sample");
    expect(out[3].content![0].text).toBe("mixed sample");
  });
});

describe("mergeMappings", () => {
  it("A→B と B→C を A→C に畳む", () => {
    const m = mergeMappings({ material: { A: "B" } }, { material: { B: "C" } });
    expect(m.material).toEqual({ A: "C", B: "C" });
  });
});
