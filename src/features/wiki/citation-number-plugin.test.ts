// @vitest-environment jsdom
//
// ナレッジページの引用を番号で見せる decoration。番号は References の並び順で決まり、
// 本文の「@題」には番号の印、References の各行には頭の番号が付く。

import { describe, it, expect } from "vitest";
import { BlockNoteEditor } from "@blocknote/core";
import { buildCitationNumberDecorations } from "./citation-number-plugin";

const blue = (text: string) => ({ type: "text", text, styles: { textColor: "blue" } });
const plain = (text: string) => ({ type: "text", text, styles: {} });

function docOf(blocks: any[]) {
  const editor = BlockNoteEditor.create({ initialContent: blocks });
  return editor.prosemirrorState.doc;
}

/** 本文の印（inline）と References の頭の番号（widget）を読み出す */
function readDecorations(blocks: any[]) {
  const doc = docOf(blocks);
  const set = buildCitationNumberDecorations(doc);
  const found = set.find();
  const inline = found
    .filter((d: any) => (d as any).type?.attrs?.class)
    .map((d: any) => ({
      text: doc.textBetween(d.from, d.to),
      num: d.type.attrs["data-cite-num"],
      title: d.type.attrs.title,
    }));
  const widgets = found.filter((d: any) => d.from === d.to).length;
  return { inline, widgets };
}

const references = (titles: string[]) => [
  { type: "heading", props: { level: 2 }, content: "References" },
  ...titles.map((t) => ({ type: "bulletListItem", content: [blue(`@${t}`)] })),
];

describe("buildCitationNumberDecorations", () => {
  it("本文の @題 に References の順の番号を付ける", () => {
    const { inline, widgets } = readDecorations([
      { type: "paragraph", content: [plain("一つ目"), blue("@資料B"), plain("。二つ目"), blue("@資料A"), plain("。")] },
      ...references(["資料A", "資料B"]),
    ]);
    expect(inline).toEqual([
      { text: "@資料B", num: "2", title: "資料B" },
      { text: "@資料A", num: "1", title: "資料A" },
    ]);
    expect(widgets).toBe(2);
  });

  it("同じ資料が段落に何度出ても同じ番号", () => {
    const { inline } = readDecorations([
      { type: "paragraph", content: [plain("a"), blue("@長い質問文の題"), plain("b"), blue("@長い質問文の題")] },
      ...references(["長い質問文の題"]),
    ]);
    expect(inline.map((d) => d.num)).toEqual(["1", "1"]);
  });

  it("References に無い資料と見出しへの参照（@#）は番号にしない", () => {
    const { inline } = readDecorations([
      { type: "paragraph", content: [blue("@載っていない資料"), plain(" "), blue("@#見出し"), plain(" "), blue("@資料A")] },
      ...references(["資料A"]),
    ]);
    expect(inline).toEqual([{ text: "@資料A", num: "1", title: "資料A" }]);
  });

  it("References が無いページでは何もしない", () => {
    const { inline, widgets } = readDecorations([
      { type: "paragraph", content: [blue("@資料A")] },
    ]);
    expect(inline).toEqual([]);
    expect(widgets).toBe(0);
  });

  it("References の後ろの別の見出しの節は本文として扱う", () => {
    const { inline } = readDecorations([
      ...references(["資料A"]),
      { type: "heading", props: { level: 2 }, content: "メモ" },
      { type: "paragraph", content: [blue("@資料A")] },
    ]);
    expect(inline).toEqual([{ text: "@資料A", num: "1", title: "資料A" }]);
  });
});
