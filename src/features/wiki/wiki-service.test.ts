import { describe, expect, it } from "vitest";
import { parseInlineCitations } from "./wiki-service";

const emptyIndex: any[] = [];

describe("parseInlineCitations - markdown inline", () => {
  it("**bold** をボールド スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("これは **重要** な点", emptyIndex);
    expect(inlineContent).toEqual([
      { type: "text", text: "これは ", styles: {} },
      { type: "text", text: "重要", styles: { bold: true } },
      { type: "text", text: " な点", styles: {} },
    ]);
  });

  it("*italic* をイタリック スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("これは *斜体* です", emptyIndex);
    expect(inlineContent).toContainEqual({ type: "text", text: "斜体", styles: { italic: true } });
  });

  it("`code` をコード スタイルに変換する", () => {
    const { inlineContent } = parseInlineCitations("`foo()` を呼ぶ", emptyIndex);
    expect(inlineContent[0]).toEqual({ type: "text", text: "foo()", styles: { code: true } });
  });

  it("[text](url) を BlockNote link に変換する", () => {
    const { inlineContent } = parseInlineCitations("見よ [これ](https://example.com) を", emptyIndex);
    expect(inlineContent).toContainEqual({
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "これ", styles: {} }],
    });
  });

  it("装飾を含まないテキストはプレーンのまま", () => {
    const { inlineContent } = parseInlineCitations("ただのテキスト", emptyIndex);
    expect(inlineContent).toEqual([{ type: "text", text: "ただのテキスト", styles: {} }]);
  });
});

describe("parseInlineCitations - citations", () => {
  it("既存ノートの [[title]] を青い @リンクに変換し knowledgeLinks を出力する", () => {
    const noteIndex = [{ id: "n1", title: "ZnO 還元実験", isWiki: false } as any];
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "詳細は [[ZnO 還元実験]] を見よ",
      noteIndex,
    );
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "@ZnO 還元実験",
      styles: { textColor: "blue" },
    });
    expect(knowledgeLinks).toHaveLength(1);
    expect(knowledgeLinks[0].targetNoteId).toBe("n1");
  });

  it("Wiki の [[title]] は 🤖 プレフィックス付きの青リンクになる", () => {
    const noteIndex = [{ id: "w1", title: "Wikiページ", isWiki: true } as any];
    const { inlineContent } = parseInlineCitations("[[Wikiページ]]", noteIndex);
    expect(inlineContent[0]).toEqual({
      type: "text",
      text: "@🤖 Wikiページ",
      styles: { textColor: "blue" },
    });
  });

  it("Chat: 引用はリンクできず、イタリック+グレーで描画される", () => {
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "詳細は [[Chat: ある議論]] を",
      emptyIndex,
    );
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "Chat: ある議論",
      styles: { italic: true, textColor: "gray" },
    });
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("noteIndex にマッチしない [[title]] はプレーンテキスト化される", () => {
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "[[未知のノート]]",
      emptyIndex,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: "未知のノート", styles: {} });
    expect(knowledgeLinks).toHaveLength(0);
  });

  it("[[https://...]] は BlockNote link に変換される", () => {
    const { inlineContent } = parseInlineCitations("[[https://example.com]]", emptyIndex);
    expect(inlineContent[0]).toEqual({
      type: "link",
      href: "https://example.com",
      content: [{ type: "text", text: "https://example.com", styles: {} }],
    });
  });

  it("LLM が稀に出す [Chat: ...]] (単一の `[`) を [[Chat: ...]] に補正する", () => {
    const { inlineContent } = parseInlineCitations("文脈は [Chat: 議論名]] にある", emptyIndex);
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "Chat: 議論名",
      styles: { italic: true, textColor: "gray" },
    });
  });
});

describe("parseInlineCitations - 装飾と引用の組み合わせ", () => {
  it("**bold** と [[citation]] が同じテキスト内に共存できる", () => {
    const noteIndex = [{ id: "n1", title: "実験A", isWiki: false } as any];
    const { inlineContent, knowledgeLinks } = parseInlineCitations(
      "**結論**: [[実験A]] が成功した",
      noteIndex,
    );
    expect(inlineContent[0]).toEqual({ type: "text", text: "結論", styles: { bold: true } });
    expect(inlineContent).toContainEqual({
      type: "text",
      text: "@実験A",
      styles: { textColor: "blue" },
    });
    expect(knowledgeLinks).toHaveLength(1);
  });
});
