// @vitest-environment jsdom
//
// 折りたたみ範囲の計算。「どこまでが見出しの配下か」の判断がこの機能の中心なので、
// ヘッドレス BlockNoteEditor の実ドキュメントに対して固定する。

import { describe, it, expect } from "vitest";
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  createHeadingBlockSpec,
} from "@blocknote/core";
import {
  computeHiddenRanges,
  collectHeadingIds,
  hidingHeadingAt,
  analyzeDocument,
} from "./collapse-range";

function makeEditor(initialContent: any[]) {
  const schema = BlockNoteSchema.create({
    blockSpecs: {
      ...defaultBlockSpecs,
      heading: createHeadingBlockSpec({ allowToggleHeadings: false }),
    } as any,
  });
  return BlockNoteEditor.create({ schema, initialContent } as any);
}

const h = (level: number, text: string, children?: any[]) => ({
  type: "heading",
  props: { level },
  content: text,
  ...(children ? { children } : {}),
});
const p = (text: string) => ({ type: "paragraph", content: text });

/** 隠れているブロックのテキストを文書順に返す（範囲を人が読める形にする）。 */
function hiddenTexts(editor: any, collapsedIds: string[]): string[] {
  const doc = editor._tiptapEditor.state.doc;
  const ranges = computeHiddenRanges(doc, new Set(collapsedIds));
  const texts: string[] = [];
  for (const r of ranges) {
    doc.nodesBetween(r.from, r.to, (node: any, pos: number) => {
      if (node.type.name === "blockContainer" && pos >= r.from && pos < r.to) {
        const first = node.firstChild;
        if (first?.textContent) texts.push(first.textContent);
      }
      return true;
    });
  }
  return texts;
}

/** タイトル文字列から blockContainer の id を引く。 */
function idOf(editor: any, text: string): string {
  const found = editor.document.find((b: any) => {
    const c = b.content;
    return Array.isArray(c) && c[0]?.text === text;
  });
  if (!found) throw new Error(`block not found: ${text}`);
  return found.id;
}

describe("computeHiddenRanges", () => {
  it("何も畳んでいなければ範囲は空", () => {
    const ed = makeEditor([h(1, "H1"), p("body")]);
    expect(computeHiddenRanges(ed._tiptapEditor.state.doc, new Set())).toEqual([]);
  });

  it("見出しを畳むと、次の同レベル見出しの手前までが隠れる", () => {
    const ed = makeEditor([
      h(2, "条件"),
      p("温度は 300 K"),
      p("圧力は 1 atm"),
      h(2, "結果"),
      p("収率 82%"),
    ]);
    expect(hiddenTexts(ed, [idOf(ed, "条件")])).toEqual(["温度は 300 K", "圧力は 1 atm"]);
  });

  it("下位の見出しはその配下ごと隠れる", () => {
    const ed = makeEditor([
      h(1, "実験"),
      p("概要"),
      h(2, "条件"),
      p("温度"),
      h(3, "補足"),
      p("備考"),
      h(1, "考察"),
      p("まとめ"),
    ]);
    expect(hiddenTexts(ed, [idOf(ed, "実験")])).toEqual([
      "概要", "条件", "温度", "補足", "備考",
    ]);
  });

  it("上位の見出しは境界になる（H3 を畳んでも次の H2 は隠れない）", () => {
    const ed = makeEditor([h(3, "補足"), p("備考"), h(2, "結果"), p("収率")]);
    expect(hiddenTexts(ed, [idOf(ed, "補足")])).toEqual(["備考"]);
  });

  it("同レベルの見出しが続くだけなら何も隠れない", () => {
    const ed = makeEditor([h(2, "A"), h(2, "B")]);
    expect(hiddenTexts(ed, [idOf(ed, "A")])).toEqual([]);
  });

  it("末尾の見出しはそこから最後までを隠す", () => {
    const ed = makeEditor([h(2, "A"), p("a1"), h(2, "B"), p("b1"), p("b2")]);
    expect(hiddenTexts(ed, [idOf(ed, "B")])).toEqual(["b1", "b2"]);
  });

  it("旧トグル見出しの children も隠す（ネストされた中身）", () => {
    const ed = makeEditor([h(2, "条件", [p("ネストされた本文")]), p("兄弟の本文"), h(2, "結果")]);
    expect(hiddenTexts(ed, [idOf(ed, "条件")])).toEqual(["ネストされた本文", "兄弟の本文"]);
  });

  it("複数を畳んでも範囲が重複しない", () => {
    const ed = makeEditor([h(1, "実験"), p("概要"), h(2, "条件"), p("温度"), h(1, "考察")]);
    const ranges = computeHiddenRanges(
      ed._tiptapEditor.state.doc,
      new Set([idOf(ed, "実験"), idOf(ed, "条件")]),
    );
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].from).toBeGreaterThanOrEqual(sorted[i - 1].to);
    }
    expect(hiddenTexts(ed, [idOf(ed, "実験"), idOf(ed, "条件")])).toEqual(["概要", "条件", "温度"]);
  });

  it("展開中の見出しの children にある、畳まれた見出しも効く", () => {
    const ed = makeEditor([h(1, "親", [h(2, "子"), p("孫の本文")])]);
    expect(hiddenTexts(ed, [idOf(ed, "親")])).toEqual(["子", "孫の本文"]);
  });

  it("見出しより前のブロックは誰の配下でもない", () => {
    const ed = makeEditor([p("前書き"), h(2, "A"), p("a1")]);
    expect(hiddenTexts(ed, [idOf(ed, "A")])).toEqual(["a1"]);
  });
});

describe("collectHeadingIds", () => {
  it("見出しブロックの id だけを集める", () => {
    const ed = makeEditor([h(1, "H1"), p("body"), h(2, "H2", [p("child")])]);
    const ids = collectHeadingIds(ed._tiptapEditor.state.doc);
    expect(ids.size).toBe(2);
    expect(ids.has(idOf(ed, "H1"))).toBe(true);
    expect(ids.has(idOf(ed, "H2"))).toBe(true);
  });
});

describe("hidingHeadingAt", () => {
  it("範囲の内側なら、隠している見出しの id を返す", () => {
    const ranges = [{ from: 10, to: 20, headingId: "h-1" }];
    expect(hidingHeadingAt(ranges, 15)).toBe("h-1");
    expect(hidingHeadingAt(ranges, 10)).toBeNull();
    expect(hidingHeadingAt(ranges, 20)).toBeNull();
    expect(hidingHeadingAt(ranges, 5)).toBeNull();
  });

  it("カーソルが畳んだ中に入ったとき、開くべき見出しが引ける", () => {
    const ed = makeEditor([h(2, "条件"), p("温度"), h(2, "結果")]);
    const doc = ed._tiptapEditor.state.doc;
    const id = idOf(ed, "条件");
    const ranges = computeHiddenRanges(doc, new Set([id]));
    expect(hidingHeadingAt(ranges, ranges[0].from + 1)).toBe(id);
  });
});

describe("analyzeDocument（▶ を出す見出しの判定）", () => {
  it("配下が空の見出しは collapsible: false", () => {
    const ed = makeEditor([h(2, "A"), h(2, "B")]);
    const { headings } = analyzeDocument(ed._tiptapEditor.state.doc, new Set());
    expect(headings.map((x) => x.collapsible)).toEqual([false, false]);
  });

  it("配下があれば collapsible: true", () => {
    const ed = makeEditor([h(2, "A"), p("a1"), h(2, "B")]);
    const { headings } = analyzeDocument(ed._tiptapEditor.state.doc, new Set());
    expect(headings.map((x) => x.collapsible)).toEqual([true, false]);
  });

  it("children だけを持つ見出しも collapsible: true（旧トグル見出し）", () => {
    const ed = makeEditor([h(2, "A", [p("nested")]), h(2, "B")]);
    const { headings } = analyzeDocument(ed._tiptapEditor.state.doc, new Set());
    expect(headings[0].collapsible).toBe(true);
  });

  it("畳まれた中の見出しも一覧には出る（▶ 自体は CSS で隠れる）", () => {
    const ed = makeEditor([h(1, "親"), h(2, "子"), p("本文"), h(1, "次")]);
    const { headings } = analyzeDocument(
      ed._tiptapEditor.state.doc,
      new Set([idOf(ed, "親")]),
    );
    expect(headings.map((x) => x.id)).toContain(idOf(ed, "子"));
  });

  it("見出しの位置は blockContainer の開始位置", () => {
    const ed = makeEditor([h(1, "H1")]);
    const doc = ed._tiptapEditor.state.doc;
    const { headings } = analyzeDocument(doc, new Set());
    expect(doc.nodeAt(headings[0].pos)?.type.name).toBe("blockContainer");
  });
});
