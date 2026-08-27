// markdown-to-blocks.ts の変換ロジックの回帰テスト。
// scripts/claude-code-skill/save-to-graphium/save.mjs との重複実装であり、
// 挙動が食い違っていないかをここで最低限保証する。

import { describe, it, expect } from "vitest";
import {
  markdownToBlocks,
  parseInlineContent,
  type Block,
} from "./markdown-to-blocks";

/** BlockNote のブロック content からプレーンテキストだけを取り出す小ヘルパー */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const item = c as Record<string, unknown>;
      if (typeof item.text === "string") return item.text;
      if (Array.isArray(item.content)) return textOf(item.content);
      return "";
    })
    .join("");
}

describe("markdownToBlocks", () => {
  it("見出しを heading ブロックに変換する", () => {
    const blocks = markdownToBlocks("# Title\n## Sub\n### SubSub");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ type: "heading" });
    expect((blocks[0].props as Record<string, unknown>).level).toBe(1);
    expect(textOf(blocks[0].content)).toBe("Title");
    expect((blocks[1].props as Record<string, unknown>).level).toBe(2);
    expect((blocks[2].props as Record<string, unknown>).level).toBe(3);
  });

  it("空行区切りの段落を paragraph ブロックに変換する", () => {
    const blocks = markdownToBlocks("Hello\nworld\n\nSecond paragraph");
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0].content)).toBe("Hello world");
    expect(textOf(blocks[1].content)).toBe("Second paragraph");
  });

  it("箇条書き（- と番号付き）を bulletListItem ブロックに変換する", () => {
    const blocks = markdownToBlocks("- item1\n* item2\n1. item3");
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      expect(b.type).toBe("bulletListItem");
    }
    expect(textOf(blocks[0].content)).toBe("item1");
    expect(textOf(blocks[1].content)).toBe("item2");
    expect(textOf(blocks[2].content)).toBe("item3");
  });

  it("フェンス付きコードブロックを codeBlock に変換する（インライン装飾は解釈しない）", () => {
    const blocks = markdownToBlocks(
      "```ts\nconst a = 1;\n**not bold**\n```",
    );
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    expect(block.type).toBe("codeBlock");
    expect((block.props as Record<string, unknown>).language).toBe("ts");
    const content = block.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("const a = 1;\n**not bold**");
    expect(content[0].styles).toEqual({});
  });

  it("テーブルを table ブロックに変換する", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const blocks = markdownToBlocks(md);
    expect(blocks).toHaveLength(1);
    const block = blocks[0] as Block;
    expect(block.type).toBe("table");
    const content = block.content as { rows: Array<{ cells: unknown[][] }> };
    expect(content.rows).toHaveLength(2);
    expect(textOf(content.rows[0].cells[0])).toBe("a");
    expect(textOf(content.rows[0].cells[1])).toBe("b");
    expect(textOf(content.rows[1].cells[0])).toBe("1");
    expect(textOf(content.rows[1].cells[1])).toBe("2");
  });

  it("空の Markdown からは空 paragraph 1件を返す", () => {
    const blocks = markdownToBlocks("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(textOf(blocks[0].content)).toBe("");
  });
});

describe("parseInlineContent", () => {
  it("太字を bold スタイルとして解釈する", () => {
    const result = parseInlineContent("**bold text**");
    expect(result).toEqual([
      { type: "text", text: "bold text", styles: { bold: true } },
    ]);
  });

  it("斜体を italic スタイルとして解釈する", () => {
    const result = parseInlineContent("*italic text*");
    expect(result).toEqual([
      { type: "text", text: "italic text", styles: { italic: true } },
    ]);
  });

  it("インラインコードを code スタイルとして解釈する", () => {
    const result = parseInlineContent("`code`");
    expect(result).toEqual([
      { type: "text", text: "code", styles: { code: true } },
    ]);
  });

  it("リンクを link ノードとして解釈する", () => {
    const result = parseInlineContent("[label](https://example.com)");
    expect(result).toEqual([
      {
        type: "link",
        href: "https://example.com",
        content: [{ type: "text", text: "label", styles: {} }],
      },
    ]);
  });

  it("装飾が混在するテキストを複数ノードに分解する", () => {
    const result = parseInlineContent("plain **bold** and `code` end");
    expect(textOf(result)).toBe("plain bold and code end");
    expect(result.some((r) => (r as any).styles?.bold)).toBe(true);
    expect(result.some((r) => (r as any).styles?.code)).toBe(true);
  });
});
