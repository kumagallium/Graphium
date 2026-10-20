// @vitest-environment jsdom
// Markdown 取り込みの文字参照の戻し（lib/markdown-entities.ts）。
// BlockNote 0.51 からのパーサが &amp; などを戻さなくなったので、Graphium 側で CommonMark と同じに戻す。
import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { decodeEntities } from "./markdown-entities";
import { parseMarkdownToBlocksWithMath } from "../features/math/markdown-math";

const editor = () => BlockNoteEditor.create() as any;
const texts = (blocks: any[]) =>
  blocks.map((b) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? (c.content ?? []).map((x: any) => x.text).join("")).join("") : b.content));

describe("decodeEntities", () => {
  it("名前付き・10 進・16 進を戻し、知らない名前は残す", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#60; &#x3C; &copy; &nosuch;")).toBe("a & b <c> < < © &nosuch;");
  });
  it("0 と範囲外は U+FFFD", () => {
    expect(decodeEntities("&#0;&#x110000;")).toBe("��");
  });
});

describe("parseMarkdownToBlocksWithMath の文字参照", () => {
  it("本文・見出し・リンク・表の文字参照を戻す", () => {
    const blocks = parseMarkdownToBlocksWithMath(
      editor(),
      "# A &amp; B\n\nx &lt; y\n\n[P &amp; Q](https://example.com)\n\n| h &amp; |\n| --- |\n| c &lt; d |\n",
    );
    const flat = JSON.stringify(blocks);
    expect(texts(blocks).slice(0, 3)).toEqual(["A & B", "x < y", "P & Q"]);
    expect(flat).toContain("h &");
    expect(flat).toContain("c < d");
    expect(flat).not.toContain("&amp;");
    expect(flat).not.toContain("&lt;");
  });

  it("コード（インライン・ブロック）の中は書かれたとおり残す", () => {
    const blocks = parseMarkdownToBlocksWithMath(editor(), "use `&amp;` here\n\n```\n&lt;tag&gt;\n```\n");
    expect(JSON.stringify(blocks[0].content)).toContain("&amp;");
    expect(JSON.stringify(blocks[1].content)).toContain("&lt;tag&gt;");
  });

  it("上付き・下付きの中は二重に戻さない", () => {
    const blocks = parseMarkdownToBlocksWithMath(editor(), "k<sub>a&amp;lt;b</sub>");
    const sub = blocks[0].content.find((c: any) => c.styles?.subscript);
    expect(sub.text).toBe("a&lt;b");
  });
});
