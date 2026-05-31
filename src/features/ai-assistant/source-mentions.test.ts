import { describe, expect, it } from "vitest";
import { splitSourceMentions, linkifySourceMentions } from "./source-mentions";

const titleMap = new Map<string, string>([
  ["実験ノートA", "wiki-a"],
  ["実験ノートB", "wiki-b"],
]);

const tBlock = (text: string, type = "paragraph", extra: Record<string, unknown> = {}) => ({
  type,
  content: [{ type: "text", text, styles: {} }],
  children: [] as any[],
  ...extra,
});

describe("splitSourceMentions", () => {
  it("解決できる [Source] を青い @title mention に変換する", () => {
    const { nodes, wikiIds } = splitSourceMentions(`[Source: "実験ノートA"]`, {}, titleMap);
    expect(nodes).toEqual([{ type: "text", text: "@実験ノートA", styles: { textColor: "blue" } }]);
    expect(wikiIds).toEqual(["wiki-a"]);
  });

  it("前後のテキストを保持しつつ複数の [Source] を変換する", () => {
    const { nodes, wikiIds } = splitSourceMentions(
      `参考: [Source: "実験ノートA"] と [Source: "実験ノートB"] を参照`,
      {},
      titleMap,
    );
    expect(nodes).toEqual([
      { type: "text", text: "参考: ", styles: {} },
      { type: "text", text: "@実験ノートA", styles: { textColor: "blue" } },
      { type: "text", text: " と ", styles: {} },
      { type: "text", text: "@実験ノートB", styles: { textColor: "blue" } },
      { type: "text", text: " を参照", styles: {} },
    ]);
    expect(wikiIds).toEqual(["wiki-a", "wiki-b"]);
  });

  it("解決できない title はそのままテキストとして残す", () => {
    const { nodes, wikiIds } = splitSourceMentions(`[Source: "存在しないノート"]`, {}, titleMap);
    expect(nodes).toEqual([{ type: "text", text: `[Source: "存在しないノート"]`, styles: {} }]);
    expect(wikiIds).toEqual([]);
  });

  it("[Source] を含まないテキストは無変換で返す", () => {
    const styles = { bold: true };
    const { nodes, wikiIds } = splitSourceMentions("ただのテキスト", styles, titleMap);
    expect(nodes).toEqual([{ type: "text", text: "ただのテキスト", styles }]);
    expect(wikiIds).toEqual([]);
  });

  it("titleMap が空なら無変換", () => {
    const { nodes, wikiIds } = splitSourceMentions(`[Source: "実験ノートA"]`, {}, new Map());
    expect(nodes).toEqual([{ type: "text", text: `[Source: "実験ノートA"]`, styles: {} }]);
    expect(wikiIds).toEqual([]);
  });
});

describe("linkifySourceMentions", () => {
  it("各ブロックの [Source] を変換し path 付きで refs を集める", () => {
    const blocks = [
      tBlock("本文です"),
      tBlock(`[Source: "実験ノートA"]`, "bulletListItem"),
    ];
    const { blocks: out, refs } = linkifySourceMentions(blocks, titleMap);
    // ブロック数は変わらない
    expect(out).toHaveLength(2);
    // 1 つ目はそのまま
    expect(out[0].content).toEqual([{ type: "text", text: "本文です", styles: {} }]);
    // 2 つ目は青 mention 化
    expect(out[1].content).toEqual([{ type: "text", text: "@実験ノートA", styles: { textColor: "blue" } }]);
    // refs は path [1] に wiki-a
    expect(refs).toEqual([{ path: [1], wikiIds: ["wiki-a"] }]);
  });

  it("children 内の [Source] も path をネストして拾う", () => {
    const blocks = [
      {
        ...tBlock("親"),
        children: [tBlock(`子 [Source: "実験ノートB"]`)],
      },
    ];
    const { blocks: out, refs } = linkifySourceMentions(blocks, titleMap);
    expect(out[0].children[0].content).toEqual([
      { type: "text", text: "子 ", styles: {} },
      { type: "text", text: "@実験ノートB", styles: { textColor: "blue" } },
    ]);
    expect(refs).toEqual([{ path: [0, 0], wikiIds: ["wiki-b"] }]);
  });

  it("解決できる Source が無ければ refs は空", () => {
    const blocks = [tBlock("ただの本文"), tBlock(`[Source: "未知"]`)];
    const { refs } = linkifySourceMentions(blocks, titleMap);
    expect(refs).toEqual([]);
  });
});
