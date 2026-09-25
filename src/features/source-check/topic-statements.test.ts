import { describe, expect, it } from "vitest";
import { extractSourceTopicStatements, extractTopicStatements } from "./topic-statements";
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

  // 実データ（wiki トピック）で確認した形: 要点ブロックの引用は knowledgeLinks を持たず、
  // ただの inline テキストとして本文に続けて保存される。knowledgeLinks が付くのは
  // References 見出し以降の各行だけ。
  const REAL_REF_HEADING = {
    id: "ref-heading",
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: "References", styles: {} }],
  };

  it("実データの形（References 以降にしか reference リンクが無い）でも (b) 完全一致で照合する", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "bulletListItem",
          content: [
            { type: "text", text: "SiはAlサイト、TiとNbはVサイトに置換する設計が用いられている。", styles: {} },
            { type: "text", text: "元素置換でAl3Vのキャリアを調整する", styles: {} },
          ],
        },
        REAL_REF_HEADING,
        {
          id: "ref1",
          type: "bulletListItem",
          content: [{ type: "text", text: "@🤖 元素置換でAl3Vのキャリアを調整する", styles: { textColor: "blue" } }],
        },
      ],
      [
        {
          id: "l1",
          sourceBlockId: "ref1",
          targetBlockId: "",
          targetNoteId: "claim-a",
          type: "reference",
          layer: "knowledge",
          createdBy: "ai",
        },
      ],
      ["claim-a"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements).toEqual([
      { text: "SiはAlサイト、TiとNbはVサイトに置換する設計が用いられている。", blockId: "b1", claimIds: ["claim-a"] },
    ]);
  });

  it("(c) 要素が 1 つに結合され、複数の引用が区切りなく連結されていても末尾から剥がして照合する", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "bulletListItem",
          content: [
            {
              type: "text",
              text: "Ti置換では、a軸とb軸の変化は小さい一方、c軸が添加量に対して線形に大きく増加する。Ti置換でAl3Vのc軸が線形に伸びる Ti置換でAl3Vのc軸だけ大きく伸びる",
              styles: {},
            },
          ],
        },
        REAL_REF_HEADING,
        {
          id: "ref1",
          type: "bulletListItem",
          content: [{ type: "text", text: "@🤖 Ti置換でAl3Vのc軸が線形に伸びる", styles: { textColor: "blue" } }],
        },
        {
          id: "ref2",
          type: "bulletListItem",
          content: [{ type: "text", text: "@🤖 Ti置換でAl3Vのc軸だけ大きく伸びる", styles: { textColor: "blue" } }],
        },
      ],
      [
        { id: "l1", sourceBlockId: "ref1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" },
        { id: "l2", sourceBlockId: "ref2", targetBlockId: "", targetNoteId: "claim-b", type: "reference", layer: "knowledge", createdBy: "ai" },
      ],
      ["claim-a", "claim-b"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toBe("Ti置換では、a軸とb軸の変化は小さい一方、c軸が添加量に対して線形に大きく増加する。");
    expect(new Set(statements[0].claimIds)).toEqual(new Set(["claim-a", "claim-b"]));
  });

  it("食い違い・未解決 見出しの下の箇条書きも References 以降のタイトルと (b) 一致で照合対象になる", () => {
    const doc = topicDoc(
      [
        { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "食い違い・未解決", styles: {} }] },
        {
          id: "b1",
          type: "bulletListItem",
          content: [
            { type: "text", text: "Nb置換については試料作製と相評価の記録はあるが、成否は未判定である。", styles: {} },
            { type: "text", text: "Nb置換でAl3Vのキャリア調整を試みる", styles: {} },
          ],
        },
        REAL_REF_HEADING,
        {
          id: "ref1",
          type: "bulletListItem",
          content: [{ type: "text", text: "@🤖 Nb置換でAl3Vのキャリア調整を試みる", styles: { textColor: "blue" } }],
        },
      ],
      [{ id: "l1", sourceBlockId: "ref1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" }],
      ["claim-a"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements.map((s) => s.blockId)).toEqual(["b1"]);
    expect(statements[0].claimIds).toEqual(["claim-a"]);
  });

  it("タイトルが対応表に一致しない文は照合対象にならない（推測で結び付けない）", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "bulletListItem",
          content: [
            { type: "text", text: "似ているが少し違う文言のはず。", styles: {} },
            { type: "text", text: "元素置換でAl3Vのキャリアを微調整する", styles: {} }, // References のタイトルと不一致
          ],
        },
        REAL_REF_HEADING,
        {
          id: "ref1",
          type: "bulletListItem",
          content: [{ type: "text", text: "@🤖 元素置換でAl3Vのキャリアを調整する", styles: { textColor: "blue" } }],
        },
      ],
      [{ id: "l1", sourceBlockId: "ref1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" }],
      ["claim-a"],
    );
    expect(extractTopicStatements(doc)).toEqual([]);
  });

  it("[[claim:<id>]] 形式（未解決の旧形式）も derivedFromClaims にあれば照合する", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [{ type: "text", text: "この記述の出典は [[claim:claim-a]] である。", styles: {} }],
        },
      ],
      [],
      ["claim-a"],
    );
    const statements = extractTopicStatements(doc);
    expect(statements).toEqual([
      { text: "この記述の出典は  である。", blockId: "b1", claimIds: ["claim-a"] },
    ]);
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

  it("照合する文のリンクは中身の文字、インライン数式は $…$ にする（[object Object] や空文字にしない）", () => {
    const doc = topicDoc(
      [
        {
          id: "b1",
          type: "paragraph",
          content: [
            { type: "text", text: "反応は ", styles: {} },
            { type: "inlineMath", props: { latex: "\\Delta G < 0" } },
            { type: "text", text: " で進む（", styles: {} },
            { type: "link", href: "https://example.com", content: [{ type: "text", text: "測定記録", styles: {} }] },
            { type: "text", text: "）。", styles: {} },
            { type: "text", text: "@🤖 知見A", styles: { textColor: "blue" } },
          ],
        },
      ],
      [{ id: "l1", sourceBlockId: "b1", targetBlockId: "", targetNoteId: "claim-a", type: "reference", layer: "knowledge", createdBy: "ai" }],
      ["claim-a"],
    );
    expect(extractTopicStatements(doc)).toEqual([
      { text: "反応は $\\Delta G < 0$ で進む（測定記録）。", blockId: "b1", claimIds: ["claim-a"] },
    ]);
  });
});

describe("extractSourceTopicStatements - 新形式トピック（topicMarkdown）", () => {
  function sourceTopicDoc(topicMarkdown: string): GraphiumDocument {
    return {
      version: 2,
      title: "トピック",
      pages: [{ id: "p1", title: "Main", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
      wikiMeta: {
        kind: "topic",
        derivedFromNotes: [],
        derivedFromChats: [],
        derivedFromClaims: [],
        topicMarkdown,
        generatedAt: "2026-09-01T00:00:00Z",
        generatedBy: { model: "m", version: "1.0.0" },
      },
      createdAt: "2026-09-01T00:00:00Z",
      modifiedAt: "2026-09-01T00:00:00Z",
    } as GraphiumDocument;
  }

  it("[[source:<id>]] を持つ行から文と出典 id を取り出す（プレフィックス無し = 1 段）", () => {
    const doc = sourceTopicDoc("## 要点\nXRD パターンが取得された。[[source:note-a]]");
    const statements = extractSourceTopicStatements(doc);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toBe("XRD パターンが取得された。");
    expect(statements[0].claimIds).toEqual(["note-a"]);
  });

  it("見出し行・引用の無い行は対象外", () => {
    const doc = sourceTopicDoc("## 定義\n前置きの説明。\n\n## 要点\n引用付きの文。[[source:note-a]]");
    const statements = extractSourceTopicStatements(doc);
    expect(statements).toHaveLength(1);
    expect(statements[0].text).toBe("引用付きの文。");
  });

  it("複数の出典を引く行は claimIds に両方積む", () => {
    const doc = sourceTopicDoc("## 要点\n共通の傾向。[[source:note-a]][[source:pdf:file-1]]");
    const statements = extractSourceTopicStatements(doc);
    expect(statements[0].claimIds).toEqual(["note-a", "pdf:file-1"]);
  });

  it("topicMarkdown が無い（旧形式）ときは空配列", () => {
    const doc = sourceTopicDoc("");
    (doc.wikiMeta as any).topicMarkdown = undefined;
    expect(extractSourceTopicStatements(doc)).toEqual([]);
  });
});
