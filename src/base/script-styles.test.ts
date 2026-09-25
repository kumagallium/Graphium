// @vitest-environment jsdom
//
// 上付き・下付き（superscript / subscript）の結合テスト
//
// 本物の BlockNoteEditor を組み立てて、表示・貼り付け・切り替え・ショートカット・
// Markdown の往復までを確かめる。純ロジックの規則は lib/script-styles.test.ts。

import { describe, it, expect, afterEach } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import type { ReactElement } from "react";
import { scriptStyleSpecs, toggleScriptStyle } from "./script-styles";
import { withScriptStyleButtons } from "./script-style-button";
import { parseMarkdownToBlocksWithMath } from "../features/math/markdown-math";
import { sanitizeBlocksForMarkdown } from "../features/markdown-export/sanitize-blocks";
import { DEFAULT_SCHEMA_INFO } from "../features/markdown-export/blocks-to-markdown";

function createEditor(initialContent?: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    styleSpecs: { ...defaultStyleSpecs, ...scriptStyleSpecs },
  });
  return BlockNoteEditor.create({ schema, initialContent } as any) as any;
}

const mounted: HTMLElement[] = [];
function mountEditor(initialContent: any[]) {
  const editor = createEditor(initialContent);
  const host = document.createElement("div");
  document.body.appendChild(host);
  editor.mount(host);
  mounted.push(host);
  return editor;
}
afterEach(() => {
  for (const host of mounted.splice(0)) host.remove();
});

/** 本文中の文字列を選択する（1 つのテキストノード内にあること） */
function selectText(editor: any, needle: string) {
  const tiptap = editor._tiptapEditor;
  let from = -1;
  tiptap.state.doc.descendants((node: any, pos: number) => {
    if (from >= 0) return false;
    if (node.isText) {
      const i = node.text.indexOf(needle);
      if (i >= 0) from = pos + i;
    }
    return true;
  });
  if (from < 0) throw new Error(`text not found: ${needle}`);
  tiptap.commands.setTextSelection({ from, to: from + needle.length });
}

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });
const para = (content: any[]) => ({ type: "paragraph", props: {}, content, children: [] });
const firstContent = (editor: any) => editor.document[0].content;

describe("表示と貼り付け", () => {
  it("上付きは <sup>、下付きは <sub> で描画する", async () => {
    const editor = createEditor();
    const html = await editor.blocksToFullHTML([
      para([text("10"), text("5", { superscript: true }), text(" H"), text("2", { subscript: true })]),
    ]);
    expect(html).toContain('<sup data-style-type="superscript"');
    expect(html).toContain('<sub data-style-type="subscript"');
  });

  it("外のアプリへコピーする HTML にも <sup> / <sub> が乗る（Word 等で保たれる）", async () => {
    const editor = createEditor();
    const html = await editor.blocksToHTMLLossy([para([text("x"), text("2", { superscript: true })])]);
    expect(html).toMatch(/x<sup[^>]*>2<\/sup>/);
  });

  it("貼り付けた <sup> / <sub> と vertical-align の span を上付き・下付きとして拾う", async () => {
    const editor = createEditor();
    const blocks = await editor.tryParseHTMLToBlocks(
      '<p>10<sup>5</sup> <span style="vertical-align: super">x</span> H<sub>2</sub>O <span style="vertical-align:sub">y</span></p>',
    );
    expect(blocks[0].content).toEqual([
      text("10"),
      text("5", { superscript: true }),
      text(" "),
      text("x", { superscript: true }),
      text(" H"),
      text("2", { subscript: true }),
      text("O "),
      text("y", { subscript: true }),
    ]);
  });
});

describe("切り替え", () => {
  it("選択範囲に上付きを付け、もう一度で外す", () => {
    const editor = mountEditor([para([text("105 Pa")])]);
    selectText(editor, "5");
    toggleScriptStyle(editor._tiptapEditor, "superscript");
    expect(firstContent(editor)).toEqual([text("10"), text("5", { superscript: true }), text(" Pa")]);

    toggleScriptStyle(editor._tiptapEditor, "superscript");
    expect(firstContent(editor)).toEqual([text("105 Pa")]);
  });

  it("上付きの文字に下付きを付けると上付きは外れる（同時には付かない）", () => {
    const editor = mountEditor([para([text("H2O")])]);
    selectText(editor, "2");
    toggleScriptStyle(editor._tiptapEditor, "superscript");
    toggleScriptStyle(editor._tiptapEditor, "subscript");
    expect(firstContent(editor)).toEqual([text("H"), text("2", { subscript: true }), text("O")]);
  });

  it("ほかの書式（太字）は残したまま付け外しする", () => {
    const editor = mountEditor([para([text("m2", { bold: true })])]);
    selectText(editor, "2");
    toggleScriptStyle(editor._tiptapEditor, "superscript");
    expect(firstContent(editor)).toEqual([text("m", { bold: true }), text("2", { bold: true, superscript: true })]);
  });
});

describe("ショートカット", () => {
  // jsdom は Mac ではないので Mod = Ctrl
  const press = (editor: any, key: string) => {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
    editor._tiptapEditor.view.dom.dispatchEvent(event);
    return event;
  };

  it("Mod-. で上付き、Mod-, で下付きを切り替える", () => {
    const editor = mountEditor([para([text("x2")])]);
    selectText(editor, "2");

    const sup = press(editor, ".");
    expect(sup.defaultPrevented).toBe(true);
    expect(firstContent(editor)).toEqual([text("x"), text("2", { superscript: true })]);

    press(editor, ",");
    expect(firstContent(editor)).toEqual([text("x"), text("2", { subscript: true })]);

    press(editor, ",");
    expect(firstContent(editor)).toEqual([text("x2")]);
  });
});

describe("ツールバーの並び", () => {
  const item = (key: string) => ({ key }) as unknown as ReactElement;

  it("取り消し線の直後に上付き → 下付きの順で差し込む", () => {
    const keys = withScriptStyleButtons([
      item("boldStyleButton"),
      item("strikeStyleButton"),
      item("textAlignLeftButton"),
    ]).map((el) => el.key);
    expect(keys).toEqual([
      "boldStyleButton",
      "strikeStyleButton",
      "superscriptStyleButton",
      "subscriptStyleButton",
      "textAlignLeftButton",
    ]);
  });

  it("取り消し線が無い並びでは末尾に足す（BlockNote 側の key 変更で消えない）", () => {
    const keys = withScriptStyleButtons([item("boldStyleButton")]).map((el) => el.key);
    expect(keys).toEqual(["boldStyleButton", "superscriptStyleButton", "subscriptStyleButton"]);
  });
});

describe("Markdown（実エディタ経由）", () => {
  /** ノートのブロック → Markdown（blocks-to-markdown.ts と同じ経路） */
  async function toMarkdown(blocks: any[]): Promise<string> {
    const editor = createEditor();
    return await editor.blocksToMarkdownLossy(sanitizeBlocksForMarkdown(blocks, DEFAULT_SCHEMA_INFO));
  }

  it("書き出しで <sup> / <sub> が残る（平文の 105 や H2O にならない）", async () => {
    const md = await toMarkdown([
      para([text("10"), text("5", { superscript: true }), text(" Pa, H"), text("2", { subscript: true }), text("O")]),
    ]);
    expect(md.trim()).toBe("10<sup>5</sup> Pa, H<sub>2</sub>O");
  });

  it("取り込みで <sup> / <sub> が上付き・下付きになる（AI の回答・論文の翻訳・.md 取り込み）", () => {
    const blocks = parseMarkdownToBlocksWithMath(
      createEditor(),
      "10<sup>5</sup> Pa, H<sub>2</sub>O と脚注<sup>[1](https://example.com/fn1)</sup>",
    );
    expect(blocks[0].content).toEqual([
      text("10"),
      text("5", { superscript: true }),
      text(" Pa, H"),
      text("2", { subscript: true }),
      text("O と脚注"),
      { type: "link", href: "https://example.com/fn1", content: [text("1", { superscript: true })] },
    ]);
  });

  it("コードの中の <sup> は文字のまま残る", () => {
    const blocks = parseMarkdownToBlocksWithMath(createEditor(), "`<sup>1</sup>` と x<sup>2</sup>");
    expect(blocks[0].content).toEqual([
      text("<sup>1</sup>", { code: true }),
      text(" と x"),
      text("2", { superscript: true }),
    ]);
  });

  // 数式（inlineMath）は BlockNote の custom inline content（content: "none"）で、
  // styles を持つ欄が無い。数式ごと上付きにはできないので、式の中身を残して
  // 外側の上付きは落とす（指数は LaTeX の ^{} で式の中に書ける）
  it("上付きの中の数式は inlineMath に戻る（数式は書式を持てないので上付きは付かない）", () => {
    const blocks = parseMarkdownToBlocksWithMath(createEditor(), "a<sup>$x^2$</sup>");
    expect(blocks[0].content).toEqual([text("a"), { type: "inlineMath", props: { latex: "x^2" } }]);
  });

  it("書き出し → 取り込みで上付き・下付きが往復する（記号・太字・リンク・表・見出し）", async () => {
    const original = [
      { type: "heading", props: { level: 2 }, content: [text("CO"), text("2", { subscript: true }), text(" の吸着")], children: [] },
      para([
        text("p"),
        text("*", { superscript: true }),
        text(" と q"),
        text("*", { superscript: true }),
        text("、面積 m"),
        text("2", { superscript: true, bold: true }),
        text("、k"),
        text("a_b<c", { subscript: true }),
      ]),
      para([{ type: "link", href: "https://example.com", content: [text("x"), text("n", { superscript: true })] }]),
      {
        type: "table",
        props: {},
        content: { type: "tableContent", rows: [{ cells: [[text("s"), text("-1", { superscript: true })], [text("値")]] }] },
        children: [],
      },
    ];
    const md = await toMarkdown(original);
    const back = parseMarkdownToBlocksWithMath(createEditor(), md);

    expect(back[0].content).toEqual([text("CO"), text("2", { subscript: true }), text(" の吸着")]);
    expect(back[1].content).toEqual([
      text("p"),
      text("*", { superscript: true }),
      text(" と q"),
      text("*", { superscript: true }),
      text("、面積 m"),
      text("2", { superscript: true, bold: true }),
      text("、k"),
      text("a_b<c", { subscript: true }),
    ]);
    // 書き出しでは href が同じ 2 つのリンクに分かれるが、取り込みで 1 つに戻る
    expect(back[2].content).toEqual([
      { type: "link", href: "https://example.com", content: [text("x"), text("n", { superscript: true })] },
    ]);
    // Markdown の表は見出し行が必須なので、書き出しで空の見出し行が 1 行付く（BlockNote 既定）
    const rows = back[3].content.rows;
    const cell = rows[rows.length - 1].cells[0];
    const cellInlines = Array.isArray(cell) ? cell : cell.content;
    expect(cellInlines).toEqual([text("s"), text("-1", { superscript: true })]);
  });
});
