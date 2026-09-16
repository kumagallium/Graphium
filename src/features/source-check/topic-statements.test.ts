import { describe, expect, it } from "vitest";
import { extractTopicStatements } from "./topic-statements";
import type { GraphiumDocument } from "../../lib/document-types";

function topicDoc(blocks: any[], knowledgeLinks: any[], derivedFromClaims: string[]): GraphiumDocument {
  return {
    version: 2,
    title: "トピック",
    pages: [{ id: "p1", title: "Main", blocks, labels: {}, provLinks: [], knowledgeLinks }],
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      derivedFromClaims,
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

const REF_HEADING = {
  id: "ref-heading",
  type: "heading",
  props: { level: 2 },
  content: [{ type: "text", text: "References", styles: {} }],
};

describe("extractTopicStatements", () => {
  it("引用を持つブロックのプレーンテキストと引いた知見 ID を返す（@タイトル部分は除く）", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [
            { type: "text", text: "電子移動律速が支配的だと ", styles: {} },
            { type: "text", text: "@🤖 知見A", styles: { textColor: "blue" } },
            { type: "text", text: " は述べている。", styles: {} },
          ],
        },
      ],
      [{ id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" }],
      ["claim-a"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements).toEqual([
      { text: "電子移動律速が支配的だと  は述べている。", blockId: "b1", claimIds: ["claim-a"] },
    ]);
  });

  it("引用を持たないブロック（定義の段落等）は無視する", () => {
    const doc = topicDoc(
      [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "定義の説明文。", styles: {} }] }],
      [],
      [],
    );
    expect(extractTopicStatements(doc)).toEqual([]);
  });

  it("References 見出し以降のブロックは無視する", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [
            { type: "text", text: "@🤖 A", styles: { textColor: "blue" } },
            { type: "text", text: " の記述と一致する。", styles: {} },
          ],
        },
        REF_HEADING,
        {
          id: "b2",
          type: "bulletListItem",
          content: [
            { type: "text", text: "@🤖 A", styles: { textColor: "blue" } },
            { type: "text", text: " も同様。", styles: {} },
          ],
        },
      ],
      [
        { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" },
        { id: "l2", sourceBlockId: "b2", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" },
      ],
      ["claim-a"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements.map((s) => s.blockId)).toEqual(["b1"]);
  });

  it("derivedFromClaims に無い targetNoteId（削除済みメンバー等）は無視する", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [
            { type: "text", text: "本文。", styles: {} },
            { type: "text", text: "@🤖 消えた知見", styles: { textColor: "blue" } },
          ],
        },
      ],
      [{ id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-removed", type: "reference", layer: "knowledge", createdBy: "ai" }],
      ["claim-a"], // claim-removed は含まれない
    );
    expect(extractTopicStatements(doc)).toEqual([]);
  });

  it("wikiMeta.kind が topic 以外なら空配列", () => {
    const doc = topicDoc([], [], []);
    doc.wikiMeta!.kind = "claim";
    expect(extractTopicStatements(doc)).toEqual([]);
  });

  it("1 つのブロックが複数の知見を引いていれば claimIds に複数入る", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [
            { type: "text", text: "@🤖 知見A", styles: { textColor: "blue" } },
            { type: "text", text: " と ", styles: {} },
            { type: "text", text: "@🤖 知見B", styles: { textColor: "blue" } },
            { type: "text", text: " は一致する。", styles: {} },
          ],
        },
      ],
      [
        { id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" },
        { id: "l2", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-b", type: "reference", layer: "knowledge", createdBy: "ai" },
      ],
      ["claim-a", "claim-b"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements).toHaveLength(1);
    expect(statements[0].claimIds).toEqual(["claim-a", "claim-b"]);
    expect(statements[0].text).toBe("と  は一致する。");
  });
});
