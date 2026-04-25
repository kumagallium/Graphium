import { describe, expect, it } from "vitest";
import { extractLabelMarkersFromBlocks, buildLabeledOutputInstruction } from "./label-markers";

const tBlock = (text: string, type = "paragraph", extra: Record<string, unknown> = {}) => ({
  type,
  content: [{ type: "text", text, styles: {} }],
  children: [] as any[],
  ...extra,
});

describe("extractLabelMarkersFromBlocks", () => {
  it("先頭マーカーを剥がしてラベルを返す", () => {
    const blocks = [
      tBlock("[[label:procedure]] 試料 A と B を混合"),
      tBlock("[[label:material]] 試料 A"),
      tBlock("普通の段落"),
      tBlock("[[label:result]] 単相結晶相", "bulletListItem"),
    ];
    const { blocks: out, labels } = extractLabelMarkersFromBlocks(blocks);
    expect(labels).toEqual([
      { path: [0], label: "procedure" },
      { path: [1], label: "material" },
      { path: [3], label: "result" },
    ]);
    expect(out[0].content[0].text).toBe("試料 A と B を混合");
    expect(out[1].content[0].text).toBe("試料 A");
    expect(out[2].content[0].text).toBe("普通の段落");
    expect(out[3].content[0].text).toBe("単相結晶相");
  });

  it("未知のラベル名は剥がさない", () => {
    const blocks = [tBlock("[[label:unknown]] hello")];
    const { blocks: out, labels } = extractLabelMarkersFromBlocks(blocks);
    expect(labels).toEqual([]);
    expect(out[0].content[0].text).toBe("[[label:unknown]] hello");
  });

  it("行頭以外のマーカーは無視する", () => {
    const blocks = [tBlock("foo [[label:procedure]] bar")];
    const { labels } = extractLabelMarkersFromBlocks(blocks);
    expect(labels).toEqual([]);
  });

  it("children を再帰的に走査する", () => {
    const blocks = [
      {
        ...tBlock("親"),
        children: [tBlock("[[label:tool]] 電気炉"), tBlock("[[label:attribute]] 80℃")],
      },
    ];
    const { labels } = extractLabelMarkersFromBlocks(blocks);
    expect(labels).toEqual([
      { path: [0, 0], label: "tool" },
      { path: [0, 1], label: "attribute" },
    ]);
  });

  it("先頭テキストが空になったら inline 要素を取り除く", () => {
    const blocks = [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "[[label:procedure]] ", styles: {} },
          { type: "text", text: "後続テキスト", styles: { bold: true } },
        ],
        children: [],
      },
    ];
    const { blocks: out } = extractLabelMarkersFromBlocks(blocks);
    expect(out[0].content).toHaveLength(1);
    expect(out[0].content[0].text).toBe("後続テキスト");
  });

  it("元の blocks を破壊しない", () => {
    const blocks = [tBlock("[[label:result]] 結果")];
    const original = JSON.stringify(blocks);
    extractLabelMarkersFromBlocks(blocks);
    expect(JSON.stringify(blocks)).toBe(original);
  });
});

describe("buildLabeledOutputInstruction", () => {
  it("ja は日本語の指示文を返し H2 ルールを含む", () => {
    const text = buildLabeledOutputInstruction("ja");
    expect(text).toContain("PROV グラフ");
    expect(text).toContain("[[label:procedure]]");
    expect(text).toContain("H2");
  });

  it("en は英語の指示文を返し H2 ルールを含む", () => {
    const text = buildLabeledOutputInstruction("en");
    expect(text).toContain("PROV graph");
    expect(text).toContain("[[label:procedure]]");
    expect(text).toContain("H2");
  });

  it("既知でない言語は en にフォールバックする", () => {
    const text = buildLabeledOutputInstruction("fr");
    expect(text).toContain("PROV graph");
  });
});
