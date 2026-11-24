// @vitest-environment jsdom
//
// 空のリスト項目に複数行のテキストを貼ったとき、Markdown として読んで
// 入れ子のリストなどのブロックに分けて差し込むことを確かめる。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import {
  hasStructuredHtml,
  isMultilinePaste,
  pasteMultilineIntoEmptyListItem,
  toListPasteMarkdown,
} from "./multiline-list-paste";

function createEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({ blockSpecs: defaultBlockSpecs, styleSpecs: defaultStyleSpecs });
  const editor = BlockNoteEditor.create({ schema, initialContent }) as any;
  // jsdom でも editor.document を読めるようにマウントしておく
  editor.mount(document.createElement("div"));
  return editor;
}

/** ブロックを「種類:文字」の入れ子で表す（比べやすくするため） */
function outline(blocks: any[]): any[] {
  return blocks.map((b) => {
    const text = Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "";
    const node: any = { [b.type]: text };
    if (b.children?.length) node.children = outline(b.children);
    return node;
  });
}

// スクリーンショットの貼り付けと同じ形（1 行目に記号が無く、2 行目以降が字下げした「* 」）
const PASTED = [
  "お話しする内容",
  "  * Graphium",
  "    * ①DX：過去のデータを検索readyにできる",
  "    * ②AIX：過去のデータをAI readyにできる",
  "* 確認事項",
  "  * AIの利用状況",
  "",
].join("\n");

describe("isMultilinePaste", () => {
  it("末尾の改行だけなら 1 行扱い", () => {
    expect(isMultilinePaste("abc\n")).toBe(false);
    expect(isMultilinePaste("abc\r\n\r\n")).toBe(false);
  });
  it("2 行以上なら true", () => {
    expect(isMultilinePaste("a\nb")).toBe(true);
  });
});

describe("toListPasteMarkdown", () => {
  it("1 行目に貼った先の記号を付ける", () => {
    expect(toListPasteMarkdown("a\n  * b", "bulletListItem")).toBe("* a\n  * b");
    expect(toListPasteMarkdown("a\nb", "numberedListItem")).toBe("1. a\nb");
    expect(toListPasteMarkdown("a\nb", "checkListItem")).toBe("* [ ] a\nb");
  });
  it("1 行目に記号があればそのまま", () => {
    expect(toListPasteMarkdown("- a\n- b", "bulletListItem")).toBe("- a\n- b");
  });
  it("• や タブ字下げを Markdown にそろえる", () => {
    expect(toListPasteMarkdown("• a\n\t• b", "bulletListItem")).toBe("* a\n    * b");
  });
});

describe("hasStructuredHtml", () => {
  it("複数行で HTML にリストがあるときだけ true", () => {
    expect(hasStructuredHtml("a\nb", "<ul><li>a</li><li>b</li></ul>")).toBe(true);
    expect(hasStructuredHtml("a\nb", "<div>a</div><div>b</div>")).toBe(false);
    expect(hasStructuredHtml("a", "<ul><li>a</li></ul>")).toBe(false);
    expect(hasStructuredHtml("a\nb", "")).toBe(false);
  });
});

describe("pasteMultilineIntoEmptyListItem（実エディタ）", () => {
  it("字下げした「* 」が入れ子の箇条書きになる", () => {
    const editor = createEditor([{ id: "p", type: "bulletListItem", content: [] }]);
    const block = editor.getBlock("p");
    expect(pasteMultilineIntoEmptyListItem(editor, block, PASTED)).toBe(true);
    expect(outline(editor.document)).toEqual([
      {
        bulletListItem: "お話しする内容",
        children: [
          {
            bulletListItem: "Graphium",
            children: [
              { bulletListItem: "①DX：過去のデータを検索readyにできる" },
              { bulletListItem: "②AIX：過去のデータをAI readyにできる" },
            ],
          },
        ],
      },
      { bulletListItem: "確認事項", children: [{ bulletListItem: "AIの利用状況" }] },
    ]);
    // 「* 」が文字として残らない
    expect(JSON.stringify(editor.document)).not.toContain("* ");
  });

  it("見出しなど他のブロックも分かれる", () => {
    const editor = createEditor([{ id: "p", type: "bulletListItem", content: [] }]);
    pasteMultilineIntoEmptyListItem(editor, editor.getBlock("p"), "項目\n\n## 見出し\n\n本文");
    expect(outline(editor.document).slice(0, 3)).toEqual([
      { bulletListItem: "項目" },
      { heading: "見出し" },
      { paragraph: "本文" },
    ]);
  });

  it("番号付きの項目に貼れば番号付きのまま", () => {
    const editor = createEditor([{ id: "p", type: "numberedListItem", content: [] }]);
    pasteMultilineIntoEmptyListItem(editor, editor.getBlock("p"), "一\n2. 二");
    expect(outline(editor.document).slice(0, 2)).toEqual([
      { numberedListItem: "一" },
      { numberedListItem: "二" },
    ]);
  });

  it("1 行だけなら扱わない（従来の救済に任せる）", () => {
    const editor = createEditor([{ id: "p", type: "bulletListItem", content: [] }]);
    expect(pasteMultilineIntoEmptyListItem(editor, editor.getBlock("p"), "一行\n")).toBe(false);
  });

  it("貼った先の項目の子は消さない", () => {
    const editor = createEditor([
      {
        id: "p",
        type: "bulletListItem",
        content: [],
        children: [{ id: "c", type: "bulletListItem", content: "既存の子" }],
      },
    ]);
    pasteMultilineIntoEmptyListItem(editor, editor.getBlock("p"), "a\n* b");
    expect(outline(editor.document).slice(0, 2)).toEqual([
      { bulletListItem: "a" },
      { bulletListItem: "b", children: [{ bulletListItem: "既存の子" }] },
    ]);
  });
});
