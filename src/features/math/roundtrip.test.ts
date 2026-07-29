// @vitest-environment jsdom
//
// 数式の往復テスト（実際の BlockNote エディタを通す統合テスト）
//
// 純ロジックのテスト（markdown-math.test.ts）とは別に、BlockNote の
// tryParseMarkdownToBlocks / blocksToMarkdownLossy を実際に通したときに
// 数式が保たれるかを確認する。ここが崩れると論文取り込みで LaTeX が本文に散る。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { parseMarkdownToBlocksWithMath } from "./markdown-math";
import { sanitizeBlocksForMarkdown } from "../markdown-export/sanitize-blocks";

function createEphemeralEditor() {
  const schema = BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs, styleSpecs: defaultStyleSpecs });
  return BlockNoteEditor.create({ schema }) as any;
}

const SCHEMA_INFO = {
  knownBlockTypes: new Set(Object.keys(defaultBlockSpecs)),
  knownStyles: new Set(Object.keys(defaultStyleSpecs)),
};

/** ブロック配列 → Markdown（doc-to-markdown と同じ経路） */
async function blocksToMarkdown(blocks: any[]): Promise<string> {
  const editor = createEphemeralEditor();
  return await editor.blocksToMarkdownLossy(sanitizeBlocksForMarkdown(blocks, SCHEMA_INFO));
}

describe("Markdown 取り込み（実エディタ経由）", () => {
  it("\\[ ... \\] が math ブロックになる（従来は [ と ] の段落に崩れていた）", () => {
    const editor = createEphemeralEditor();
    const md = "線形関係が得られる。\n\n\\[\n\\log P = \\log A - b T \\tag{2}\n\\]\n\n図 2b は…";
    const blocks = parseMarkdownToBlocksWithMath(editor, md);

    const math = blocks.find((b: any) => b.type === "math");
    expect(math).toBeDefined();
    expect(math.props.latex).toBe("\\log P = \\log A - b T \\tag{2}");
    // 生 LaTeX が段落テキストとして残っていないこと
    const paragraphText = blocks
      .filter((b: any) => b.type === "paragraph")
      .map((b: any) => (b.content ?? []).map((c: any) => c.text ?? "").join(""))
      .join("");
    expect(paragraphText).not.toContain("\\log");
    expect(paragraphText).not.toContain("[");
  });

  it("$$ ... $$ が math ブロックになる", () => {
    const editor = createEphemeralEditor();
    const blocks = parseMarkdownToBlocksWithMath(editor, "$$\nE = mc^2\n$$");
    expect(blocks[0]).toMatchObject({ type: "math", props: { latex: "E = mc^2" } });
  });

  it("本文中の \\( ... \\) が inlineMath になり、上付き・下付きが壊れない", () => {
    const editor = createEphemeralEditor();
    const blocks = parseMarkdownToBlocksWithMath(editor, "近似は \\(P = A e^{-b_1 T}\\) となる。");
    const inline = (blocks[0].content ?? []).find((c: any) => c.type === "inlineMath");
    expect(inline).toBeDefined();
    // 素の tryParse では ^ や _ の周りが強調記法に食われる
    expect(inline.props.latex).toBe("P = A e^{-b_1 T}");
  });

  it("アンダースコアを含む数式が強調記法に食われない", () => {
    const editor = createEphemeralEditor();
    const blocks = parseMarkdownToBlocksWithMath(editor, "$$ x_1 + x_2 = y_{total} $$");
    expect(blocks[0].props.latex).toBe("x_1 + x_2 = y_{total}");
  });

  it("コードブロック内の数式はそのままコードとして残る", () => {
    const editor = createEphemeralEditor();
    const blocks = parseMarkdownToBlocksWithMath(editor, "```\n$$ E = mc^2 $$\n```");
    expect(blocks.some((b: any) => b.type === "math")).toBe(false);
    expect(blocks[0].type).toBe("codeBlock");
  });
});

describe("Markdown 書き出し（実エディタ経由）", () => {
  it("math ブロックが $$ ... $$ の 1 行として出る（hard break で壊れない）", async () => {
    const md = await blocksToMarkdown([
      { type: "math", props: { latex: "\\log P = \\log A - b T \\tag{2}" }, children: [] },
    ]);
    expect(md.trim()).toBe("$$ \\log P = \\log A - b T \\tag{2} $$");
    // 行末バックスラッシュ（hard break）が混ざっていないこと
    expect(md).not.toContain("$$\\");
  });

  it("inlineMath が $ ... $ として本文に戻る", async () => {
    const md = await blocksToMarkdown([
      {
        type: "paragraph", props: {}, children: [],
        content: [
          { type: "text", text: "係数は ", styles: {} },
          { type: "inlineMath", props: { latex: "b = -0.126" } },
          { type: "text", text: " である", styles: {} },
        ],
      },
    ]);
    expect(md.trim()).toBe("係数は $b = -0.126$ である");
  });

  it("複数行の LaTeX は 1 行に潰して書き出す", async () => {
    const md = await blocksToMarkdown([
      { type: "math", props: { latex: "a = b\n+ c" }, children: [] },
    ]);
    expect(md.trim()).toBe("$$ a = b + c $$");
  });
});

describe("往復（取り込み → 書き出し → 再取り込み）", () => {
  it("ブロック数式が往復しても LaTeX が変わらない", async () => {
    const editor = createEphemeralEditor();
    const original = "\\text{Log }P = \\log A - b \\log T \\quad (4)";

    const md1 = await blocksToMarkdown([{ type: "math", props: { latex: original }, children: [] }]);
    const blocks = parseMarkdownToBlocksWithMath(editor, md1);

    expect(blocks[0]).toMatchObject({ type: "math", props: { latex: original } });
  });

  it("インライン数式が往復しても LaTeX が変わらない", async () => {
    const editor = createEphemeralEditor();
    const md1 = await blocksToMarkdown([
      {
        type: "paragraph", props: {}, children: [],
        content: [
          { type: "text", text: "ここで ", styles: {} },
          { type: "inlineMath", props: { latex: "\\sigma^2 = \\frac{1}{n}" } },
          { type: "text", text: " とする", styles: {} },
        ],
      },
    ]);
    const blocks = parseMarkdownToBlocksWithMath(editor, md1);
    const inline = (blocks[0].content ?? []).find((c: any) => c.type === "inlineMath");
    expect(inline.props.latex).toBe("\\sigma^2 = \\frac{1}{n}");
  });
});
