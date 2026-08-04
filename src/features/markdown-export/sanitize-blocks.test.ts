// sanitize-blocks.ts（一括 Markdown 変換前のブロックサニタイズ）のユニットテスト

import { describe, it, expect } from "vitest";
import {
  sanitizeBlocksForMarkdown,
  extractInlineText,
  mentionToWikiLinkText,
  convertMentionsToWikiLinks,
  type SanitizeSchemaInfo,
} from "./sanitize-blocks";

// default スキーマ相当のテスト用 schema 情報
// （実物は doc-to-markdown.ts が defaultBlockSpecs / defaultStyleSpecs から導出する）
const SCHEMA: SanitizeSchemaInfo = {
  knownBlockTypes: new Set([
    "paragraph", "heading", "quote", "bulletListItem", "numberedListItem",
    "checkListItem", "codeBlock", "table", "file", "image", "video", "audio",
  ]),
  knownStyles: new Set([
    "bold", "italic", "underline", "strike", "code", "textColor", "backgroundColor",
  ]),
};

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });

describe("sanitizeBlocksForMarkdown", () => {
  it("標準ブロックはそのまま維持する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ id: "b1", type: "heading", props: { level: 2 }, content: [text("Title")], children: [] }],
      SCHEMA,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("heading");
    expect(result[0].props).toEqual({ level: 2 });
    expect(result[0].content).toEqual([text("Title")]);
    // id はヘッドレスエディタ側で採番させるため落とす
    expect(result[0].id).toBeUndefined();
  });

  it("未知のカスタム style（来歴ハイライト）を取り除き、既知 style は残す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph",
        content: [text("KOH aq", { bold: true, inlineMaterial: "entity-123" })],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("KOH aq", { bold: true })]);
  });

  it("bookmark ブロックをリンク付き paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "bookmark",
        props: { url: "https://example.com/x", title: "Example", domain: "example.com" },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([
      { type: "link", href: "https://example.com/x", content: [text("Example")] },
    ]);
  });

  it("pdfViewer ブロックをファイル名リンクの paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "pdfViewer", props: { url: "local-media://abc", name: "paper.pdf" }, children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([
      { type: "link", href: "local-media://abc", content: [text("paper.pdf")] },
    ]);
  });

  it("callout ブロックは本文を維持した paragraph に変換する", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "callout", props: { variant: "warning" }, content: [text("注意書き")], children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([text("注意書き")]);
  });

  it("未知ブロックはプレーンテキストの paragraph にフォールバックする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "futureBlock", content: [text("hello "), text("world")], children: [] }],
      SCHEMA,
    );
    expect(result[0].type).toBe("paragraph");
    expect(result[0].content).toEqual([text("hello world")]);
  });

  it("children を再帰的にサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "bulletListItem",
        content: [text("parent")],
        children: [{
          type: "bulletListItem",
          content: [text("child", { inlineTool: "entity-9" })],
          children: [],
        }],
      }],
      SCHEMA,
    );
    expect(result[0].children[0].content).toEqual([text("child")]);
  });

  it("link inline の中の style もサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph",
        content: [{
          type: "link",
          href: "https://example.com",
          content: [text("site", { inlineOutput: "e-1", italic: true })],
        }],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([
      { type: "link", href: "https://example.com", content: [text("site", { italic: true })] },
    ]);
  });

  it("table のセル内 style をサニタイズする（配列セル形式）", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("A", { inlineMaterial: "e-1" })], [text("B")]] }],
        },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content.rows[0].cells).toEqual([[text("A")], [text("B")]]);
  });

  it("table の tableCell オブジェクト形式のセルもサニタイズする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "table",
        content: {
          type: "tableContent",
          rows: [{ cells: [{ type: "tableCell", content: [text("X", { inlineTool: "e" })] }] }],
        },
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content.rows[0].cells).toEqual([
      { type: "tableCell", content: [text("X")] },
    ]);
  });

  it("配列でない入力には空配列を返す", () => {
    expect(sanitizeBlocksForMarkdown(undefined, SCHEMA)).toEqual([]);
    expect(sanitizeBlocksForMarkdown(null, SCHEMA)).toEqual([]);
  });

  it("math ブロックを $$ ... $$ の段落に落とす", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "math", props: { latex: "E = mc^2" }, children: [] }],
      SCHEMA,
    );
    expect(result[0]).toMatchObject({ type: "paragraph" });
    expect(result[0].content).toEqual([text("$$ E = mc^2 $$")]);
  });

  it("latex が空の math ブロックは空段落にする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{ type: "math", props: { latex: "  " }, children: [] }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([]);
  });

  it("columnList / column はラッパーを捨てて中身をカラム順に持ち上げる", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        id: "cl1",
        type: "columnList",
        children: [
          {
            id: "c1", type: "column", props: { width: 1 },
            children: [{ type: "paragraph", content: [text("左カラム")], children: [] }],
          },
          {
            id: "c2", type: "column", props: { width: 2 },
            children: [
              { type: "heading", props: { level: 2 }, content: [text("右見出し")], children: [] },
              { type: "paragraph", content: [text("右本文")], children: [] },
            ],
          },
        ],
      }],
      SCHEMA,
    );
    // ラッパー（columnList / column）は出力に残らず、空 paragraph も挟まらない
    expect(result.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(result[0].content).toEqual([text("左カラム")]);
    expect(result[1].content).toEqual([text("右見出し")]);
    expect(result[2].content).toEqual([text("右本文")]);
  });

  it("inlineMath を $ ... $ のテキストに戻す", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        type: "paragraph", props: {}, children: [],
        content: [text("係数は "), { type: "inlineMath", props: { latex: "b = -0.126" } }, text(" である")],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("係数は "), text("$b = -0.126$"), text(" である")]);
  });
});

describe("extractInlineText", () => {
  it("text inline を連結する", () => {
    expect(extractInlineText([text("a"), text("b")])).toBe("ab");
  });

  it("link inline の中のテキストも拾う", () => {
    expect(
      extractInlineText([{ type: "link", href: "x", content: [text("label")] }]),
    ).toBe("label");
  });

  it("inlineMath は $ ... $ の表記で拾う", () => {
    expect(extractInlineText([text("係数 "), { type: "inlineMath", props: { latex: "x^2" } }])).toBe("係数 $x^2$");
  });

  it("配列以外は空文字を返す", () => {
    expect(extractInlineText(undefined)).toBe("");
    expect(extractInlineText({})).toBe("");
  });
});

describe("mentionToWikiLinkText", () => {
  it("青文字の @タイトル を [[タイトル]] にする", () => {
    expect(mentionToWikiLinkText(text("@Other Note", { textColor: "blue" }))).toBe("[[Other Note]]");
  });

  it("Wiki メンションの 🤖 プレフィックスは剥がす", () => {
    expect(mentionToWikiLinkText(text("@🤖 Perovskite", { textColor: "blue" }))).toBe("[[Perovskite]]");
  });

  it("青くない @ テキストは変換しない", () => {
    expect(mentionToWikiLinkText(text("@twitter_handle"))).toBeNull();
  });

  it("@ で始まらない青文字は変換しない", () => {
    expect(mentionToWikiLinkText(text("blue text", { textColor: "blue" }))).toBeNull();
  });

  it("@ のみ（タイトル空）は変換しない", () => {
    expect(mentionToWikiLinkText(text("@", { textColor: "blue" }))).toBeNull();
  });
});

describe("sanitizeBlocksForMarkdown のメンション変換", () => {
  it("paragraph 内のメンションを [[タイトル]] テキストにする", () => {
    const result = sanitizeBlocksForMarkdown(
      [{
        id: "b1",
        type: "paragraph",
        props: {},
        content: [text("see "), text("@Other Note", { textColor: "blue" })],
        children: [],
      }],
      SCHEMA,
    );
    expect(result[0].content).toEqual([text("see "), text("[[Other Note]]")]);
  });
});

describe("convertMentionsToWikiLinks", () => {
  it("children とテーブルセルのメンションも変換する", () => {
    const blocks = [
      {
        id: "b1",
        type: "paragraph",
        props: {},
        content: [text("@Parent", { textColor: "blue" })],
        children: [
          { id: "b2", type: "paragraph", props: {}, content: [text("@Child", { textColor: "blue" })], children: [] },
        ],
      },
      {
        id: "b3",
        type: "table",
        props: {},
        content: {
          type: "tableContent",
          rows: [{ cells: [[text("@Cell", { textColor: "blue" })]] }],
        },
        children: [],
      },
    ];
    const result = convertMentionsToWikiLinks(blocks);
    expect(result[0].content).toEqual([text("[[Parent]]")]);
    expect(result[0].children[0].content).toEqual([text("[[Child]]")]);
    expect(result[1].content.rows[0].cells[0]).toEqual([text("[[Cell]]")]);
  });

  it("元のブロック配列は変更しない（非破壊）", () => {
    const blocks = [{
      id: "b1",
      type: "paragraph",
      props: {},
      content: [text("@Note", { textColor: "blue" })],
      children: [],
    }];
    convertMentionsToWikiLinks(blocks);
    expect(blocks[0].content[0].text).toBe("@Note");
  });

  it("メンション以外の inline はそのまま維持する", () => {
    const blocks = [{
      id: "b1",
      type: "paragraph",
      props: {},
      content: [text("plain"), { type: "inlineMath", props: { latex: "x^2" } }],
      children: [],
    }];
    const result = convertMentionsToWikiLinks(blocks);
    expect(result[0].content).toEqual(blocks[0].content);
  });
});
