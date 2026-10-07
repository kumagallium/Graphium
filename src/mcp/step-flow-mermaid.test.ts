// step-flow-mermaid.ts の回帰テスト（手順の流れを Mermaid に描く）。

import { describe, it, expect } from "vitest";

import type { GraphiumDocument } from "../lib/document-types";
import { escapeMermaidLabel, renderStepFlowMermaid } from "./step-flow-mermaid";

function heading(id: string, title: string) {
  return { id, type: "heading", props: { level: 2 }, content: [{ type: "text", text: title }], children: [] };
}

function docOf(blocks: any[], labels: Record<string, string>, provLinks: any[] = []): GraphiumDocument {
  return {
    title: "テストノート",
    pages: [{ id: "p1", blocks, labels, provLinks }],
  } as unknown as GraphiumDocument;
}

const link = (id: string, from: string, to: string, extra: object = {}) => ({
  id,
  sourceBlockId: from,
  targetBlockId: to,
  type: "informed_by",
  layer: "prov",
  createdBy: "human",
  ...extra,
});

describe("renderStepFlowMermaid", () => {
  it("2 手順 + informed_by で flowchart と辺が出る", () => {
    const doc = docOf(
      [heading("h1", "1. 切る"), heading("h2", "2. 炒める")],
      { h1: "procedure", h2: "procedure" },
      [link("l1", "h2", "h1")],
    );
    const out = renderStepFlowMermaid(doc);
    expect(out.startsWith("```mermaid\nflowchart TD")).toBe(true);
    expect(out).toContain('n1["切る"]');
    expect(out).toContain('n2["炒める"]');
    expect(out).toMatch(/n1 -\.?-?>? n2/);
    expect(out.trimEnd().endsWith("Graphium の手順の流れ（StepFlow）と同じ投影です")).toBe(true);
  });

  it("ラベルの引用符・タグ・改行をエスケープする", () => {
    expect(escapeMermaidLabel('a"b<i>c</i>\nd')).toBe("a#quot;b#lt;i#gt;c#lt;/i#gt;<br/>d");
    const doc = docOf([heading("h1", '1. 5" の <b>板</b>')], { h1: "procedure" });
    const out = renderStepFlowMermaid(doc);
    expect(out).toContain("#quot;");
    expect(out).not.toContain("<b>");
  });

  it("手順が上限を超えたら先頭だけ描き、残りは注記ノードにする", () => {
    const blocks = Array.from({ length: 65 }, (_, i) => heading(`h${i}`, `${i + 1}. 手順${i + 1}`));
    const labels = Object.fromEntries(blocks.map((b) => [b.id, "procedure"]));
    const out = renderStepFlowMermaid(docOf(blocks, labels));
    expect(out).toContain("手順60");
    expect(out).not.toContain("手順61");
    expect(out).toContain("…ほか 5 件");
  });

  it("上限は options.maxSteps で変えられる", () => {
    const blocks = Array.from({ length: 4 }, (_, i) => heading(`h${i}`, `${i + 1}. 手順${i + 1}`));
    const labels = Object.fromEntries(blocks.map((b) => [b.id, "procedure"]));
    const out = renderStepFlowMermaid(docOf(blocks, labels), { maxSteps: 2 });
    expect(out).toContain("…ほか 2 件");
  });

  it("他ノート宛ての辺は [[ノート名]] の別ノードにする（名前が引けなければ id）", () => {
    const doc = docOf(
      [heading("h1", "1. 焼く")],
      { h1: "procedure" },
      [link("l1", "h1", "x", { targetNoteId: "note-other" })],
    );
    const named = renderStepFlowMermaid(doc, { noteTitleOf: () => "前処理ノート" });
    expect(named).toContain("[[前処理ノート]]");
    const unnamed = renderStepFlowMermaid(doc, { noteTitleOf: () => undefined });
    expect(unnamed).toContain("[[note-other]]");
  });

  it("手順の無いノートは「手順ブロックがありません」を返す", () => {
    const doc = docOf([{ id: "p1", type: "paragraph", content: [{ type: "text", text: "本文" }], children: [] }], {});
    expect(renderStepFlowMermaid(doc)).toContain("手順ブロックがありません");
  });
});
