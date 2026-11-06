import { describe, expect, it } from "vitest";
import {
  appendPlanCheckSection,
  buildPlanDocument,
  buildRunBlocks,
  linkRunsInPlan,
  procedureStepNames,
  resolveAnswerReferences,
  type ExperimentPlanDraft,
  type PlanNoteWords,
} from "./plan-note-builder";
import type { ProvIngesterBlock } from "./prov-note-builder";

const words: PlanNoteWords = {
  background: "背景・目的",
  samples: "対象と条件",
  sampleColumn: "対象",
  procedure: "共通の手順",
  procedureHint: "行ごとのノートに入れてあります。",
  outcome: "期待する成果",
  references: "参考にしたノート",
  runOverview: "「{plan}」の 1 行。条件: {conditions}",
};

const plan: ExperimentPlanDraft = {
  title: "Co-Ni 置換量を振る",
  background: "置換で保磁力を下げる。",
  expectedOutcome: "x とともに保磁力が下がる。",
  variables: [
    { key: "x", label: "置換量 x" },
    { key: "temperature", label: "仮焼温度", unit: "°C" },
  ],
  runs: [
    { name: "BaFe12O19 (x = 0)", values: { x: "0", temperature: "1000 °C" } },
    { name: "BaFe11.6Co0.2Ni0.2O19 (x = 0.2)", values: { x: "0.2", temperature: "1100 °C" } },
  ],
  procedure: "…",
};

const blocks: ProvIngesterBlock[] = [
  { blockType: "heading", level: 2, role: "procedure", text: "共沈", stepId: "coprec" },
  { blockType: "paragraph", content: [{ text: "x: 0", role: "attribute" }, { text: " の組成で " }, { text: "NaOH", role: "material" }] },
  { blockType: "heading", level: 2, role: "procedure", text: "仮焼", stepId: "calc" },
  { blockType: "paragraph", content: [{ text: "Temperature: 1000 °C", role: "attribute" }, { text: "pH: 10", role: "attribute" }] },
  { blockType: "paragraph", content: [{ text: "予備加熱 " }, { text: "温度: 500 °C", role: "attribute" }, { text: " のあと 1000 ℃ で焼く。x = 0 の組成、0 回目" }] },
];

describe("buildRunBlocks", () => {
  it("1 行目の値を本文から探して、この行の値に差し替える（キーではなく値で探す）", () => {
    const out = buildRunBlocks(blocks, plan, plan.runs[1], words);
    expect(out[0].content![0].text).toBe("「Co-Ni 置換量を振る」の 1 行。条件: 置換量 x = 0.2, 仮焼温度 = 1100 °C");
    expect(out[2].content![0].text).toBe("x: 0.2");
    expect(out[4].content![0].text).toBe("Temperature: 1100 °C");
    expect(out[4].content![1].text).toBe("pH: 10");
    // 同じ「温度」でも 1 行目の値でない予備加熱は変えない。地の文は単位付きの値と「x = 0」だけ変える
    const prose = out[5].content!;
    expect(prose[1].text).toBe("温度: 500 °C");
    expect(prose[2].text).toBe(" のあと 1100 °C で焼く。x = 0.2 の組成、0 回目");
    // 元のブロックは書き換えない
    expect(blocks[1].content![0].text).toBe("x: 0");
  });
  it("1 行目そのものは何も変えない", () => {
    const out = buildRunBlocks(blocks, plan, plan.runs[0], words);
    expect(out.slice(1)).toEqual(blocks);
  });
});

describe("buildPlanDocument / linkRunsInPlan", () => {
  it("計画フォルダに入り、1 列目が note-link の表と参考ノートへのリンクを持つ", () => {
    const { doc, tableBlockId } = buildPlanDocument({
      plan,
      stepNames: procedureStepNames(blocks),
      references: [{ id: "paper-1", title: "BaFe12O19 の共沈" }],
      folder: "計画",
      words,
      model: "m",
    });
    expect(doc.noteContexts).toEqual(["計画"]);
    const page = doc.pages[0];
    expect(page.tableMeta?.[tableBlockId]?.columns).toEqual({ 対象: ["note-link"] });
    const table = (page.blocks as any[]).find((b) => b.id === tableBlockId);
    expect(table.content.rows[0].cells.map((c: any) => c[0].text)).toEqual(["対象", "置換量 x", "仮焼温度 (°C)"]);
    expect(table.content.rows[2].cells.map((c: any) => c[0].text)).toEqual(["BaFe11.6Co0.2Ni0.2O19 (x = 0.2)", "0.2", "1100 °C"]);
    expect(page.knowledgeLinks).toHaveLength(1);
    expect(page.knowledgeLinks[0]).toMatchObject({ targetNoteId: "paper-1", type: "reference", layer: "knowledge" });
    expect(doc.noteLinks).toEqual([{ targetNoteId: "paper-1", sourceBlockId: page.knowledgeLinks[0].sourceBlockId, type: "derived_from" }]);
    // 題は doc.title。本文に H1 は置かない
    expect((page.blocks as any[]).some((b) => b.type === "heading" && b.props.level === 1)).toBe(false);
    const bullets = (page.blocks as any[]).filter((b) => b.type === "bulletListItem").map((b) => b.content[0].text);
    expect(bullets).toEqual(["共沈", "仮焼"]);

    const linked = linkRunsInPlan(doc, tableBlockId, [
      { name: "BaFe12O19 (x = 0)", id: "run-0" },
      { name: "BaFe11.6Co0.2Ni0.2O19 (x = 0.2)", id: "run-2" },
    ]);
    const lp = linked.pages[0];
    const lt = (lp.blocks as any[]).find((b) => b.id === tableBlockId);
    expect(lt.content.rows[1].cells[0][0]).toMatchObject({ text: "@BaFe12O19 (x = 0)", styles: { textColor: "blue" } });
    expect(lt.content.rows[1].cells[1][0].text).toBe("0");
    expect(lp.tableMeta?.[tableBlockId]?.noteLinks).toMatchObject({
      "BaFe12O19 (x = 0)": "run-0",
      "@BaFe12O19 (x = 0)": "run-0",
    });
    expect(lp.tableMeta?.[tableBlockId]?.columns).toEqual({ 対象: ["note-link"] });
    expect(linked.noteLinks?.filter((l) => l.sourceBlockId === tableBlockId).map((l) => l.targetNoteId)).toEqual(["run-0", "run-2"]);
  });
});

describe("resolveAnswerReferences", () => {
  it("[Source: \"題\"] を題の一致するノートに引く（（ノート）の添え字・大小・重複を畳む）", () => {
    const notes = [
      { id: "a", title: "BaFe12O19 の共沈" },
      { id: "b", title: "Sr4Fe6O13 Auto-combustion" },
    ];
    const answer = `共沈 [Source: "BaFe12O19 の共沈（ノート）"] と [Source: "sr4fe6o13 auto-combustion"]、再掲 [Source: "BaFe12O19 の共沈"]、無い [Source: "X"]`;
    expect(resolveAnswerReferences(answer, notes).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("appendPlanCheckSection", () => {
  const checkWords = {
    heading: "根拠の確認",
    summary: "計画の {total} 項目のうち、参考 {source}・提案 {answer}・根拠なし {unsupported}・食い違い {conflict}。",
    hint: "確かめてください。",
    conflict: "食い違い",
    unsupported: "根拠なし",
    answer: "回答の提案",
  };
  const items = [
    { kind: "condition" as const, text: "時間 4 h", status: "source" as const, source: "論文 A" },
    { kind: "variable" as const, text: "焼成温度 800–1100 °C", status: "answer" as const },
    { kind: "material" as const, text: "ZrO2", status: "unsupported" as const, detail: "どこにも無い" },
    { kind: "condition" as const, text: "雰囲気 アルゴン", status: "conflict" as const, source: "論文 A", detail: "大気中" },
  ];
  it("要約と、食い違い → 根拠なし → 回答の提案 の順の箇条を末尾に足し、やり直しでは置き換える", () => {
    const { doc } = buildPlanDocument({ plan, stepNames: [], references: [], folder: "計画", words });
    const once = appendPlanCheckSection(doc, items, checkWords);
    const blocks = once.pages[0].blocks as any[];
    const start = blocks.findIndex((b) => b.type === "heading" && b.content[0].text === "根拠の確認");
    expect(start).toBeGreaterThan(0);
    expect(blocks[start + 1].content[0].text).toBe("計画の 4 項目のうち、参考 1・提案 1・根拠なし 1・食い違い 1。");
    expect(blocks[start + 2].content[0].text).toBe("確かめてください。");
    const bullets = blocks.slice(start + 3).map((b) => b.content.map((c: any) => c.text).join(""));
    expect(bullets).toEqual(["食い違い 雰囲気 アルゴン — 論文 A: 大気中", "根拠なし ZrO2 — どこにも無い", "回答の提案 焼成温度 800–1100 °C"]);
    const twice = appendPlanCheckSection(once, items.slice(0, 2), checkWords);
    const b2 = twice.pages[0].blocks as any[];
    expect(b2.filter((b) => b.type === "heading" && b.content[0].text === "根拠の確認")).toHaveLength(1);
    expect(b2[b2.length - 1].content.map((c: any) => c.text).join("")).toBe("回答の提案 焼成温度 800–1100 °C");
  });
});
