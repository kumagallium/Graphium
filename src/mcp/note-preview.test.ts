import { describe, expect, it } from "vitest";

import { buildNotePreview, inlineToRuns, PREVIEW_MAX_BLOCKS } from "./note-preview";

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text", text, styles });

describe("inlineToRuns", () => {
  it("書式・数式・リンクを一続きに分けて持つ", () => {
    const runs = inlineToRuns([
      t("H"),
      t("2", { subscript: true }),
      t("O は "),
      t("重要", { bold: true }),
      { type: "inlineMath", props: { latex: "x^2" } },
      { type: "link", href: "https://example.com", content: [t("出典")] },
    ]);
    expect(runs).toEqual([
      { text: "H" },
      { text: "2", script: "sub" },
      { text: "O は " },
      { text: "重要", bold: true },
      { text: "$x^2$", math: true },
      { text: "出典", link: true },
    ]);
  });

  it("リンクの URL は持たない（画面から外へ開かせない）", () => {
    const runs = inlineToRuns([{ type: "link", href: "https://example.com", content: [t("a")] }]);
    expect(JSON.stringify(runs)).not.toContain("example.com");
  });

  it("配列でなければ空", () => {
    expect(inlineToRuns(undefined)).toEqual([]);
  });
});

describe("buildNotePreview", () => {
  it("見出し・手順・ラベル・表・リスト・数式を画面向けに並べる", () => {
    const preview = buildNotePreview({
      noteId: "n1",
      modifiedAt: "2026-11-10T00:00:00Z",
      doc: {
        title: "  パン生地の発酵  ",
        noteContexts: ["パン作り"],
        generatedBy: { agent: "graphium-mcp/claude-desktop", model: "claude-opus-5-5" },
        pages: [
          {
            labels: { h1: "procedure", p1: "material" },
            blocks: [
              { id: "h1", type: "heading", props: { level: 2 }, content: [t("一次発酵")] },
              {
                id: "s1",
                type: "step",
                content: [t("こねる")],
                children: [{ id: "p1", type: "paragraph", content: [t("強力粉 300 g")] }],
              },
              {
                id: "cl",
                type: "columnList",
                children: [{ id: "c1", type: "column", children: [{ id: "b1", type: "bulletListItem", content: [t("塩")] }] }],
              },
              { id: "m1", type: "math", props: { latex: "E=mc^2" } },
              {
                id: "t1",
                type: "table",
                content: { type: "tableContent", rows: [{ cells: [[t("温度")]] }, { cells: [{ type: "tableCell", content: [t("28 ℃")] }] }] },
              },
              { id: "e1", type: "paragraph", content: [] },
              { id: "x1", type: "chart", props: {} },
            ],
          },
        ],
      },
    });

    expect(preview.title).toBe("パン生地の発酵");
    expect(preview.folder).toBe("パン作り");
    expect(preview.generatedBy).toBe("graphium-mcp/claude-desktop / claude-opus-5-5");
    expect(preview.modifiedAt).toBe("2026-11-10T00:00:00Z");
    expect(preview.truncated).toBe(false);
    expect(preview.blocks.map((b) => b.kind)).toEqual(["heading", "step", "paragraph", "bullet", "math", "table", "other"]);
    expect(preview.blocks[0]).toMatchObject({ kind: "heading", level: 2, label: "procedure" });
    expect(preview.blocks[1]).toMatchObject({ kind: "step", order: 1 });
    // step の中身は 1 段深くせず続けて並べる（blocksToMarkdown と同じ）
    expect(preview.blocks[2]).toMatchObject({ kind: "paragraph", label: "material", depth: 0 });
    expect(preview.blocks[5]).toMatchObject({ kind: "table", rows: [[[{ text: "温度" }]], [[{ text: "28 ℃" }]]] });
    expect(preview.blocks[6]).toEqual({ kind: "other", blockType: "chart" });
  });

  it("人が書いたノートには書いたものを付けない", () => {
    const preview = buildNotePreview({ noteId: "n", doc: { title: "", pages: [] } });
    expect(preview.title).toBe("(untitled)");
    expect(preview.generatedBy).toBeUndefined();
    expect(preview.blocks).toEqual([]);
  });

  it("ページが複数あれば区切り線を挟む", () => {
    const preview = buildNotePreview({
      noteId: "n",
      doc: {
        pages: [
          { blocks: [{ id: "a", type: "paragraph", content: [t("1 枚目")] }] },
          { blocks: [{ id: "b", type: "paragraph", content: [t("2 枚目")] }] },
        ],
      },
    });
    expect(preview.blocks.map((b) => b.kind)).toEqual(["paragraph", "divider", "paragraph"]);
  });

  it("長いノートは上限で切って truncated を立てる", () => {
    const blocks = Array.from({ length: PREVIEW_MAX_BLOCKS + 5 }, (_, i) => ({
      id: `p${i}`,
      type: "paragraph",
      content: [t(`行 ${i}`)],
    }));
    const preview = buildNotePreview({ noteId: "n", doc: { pages: [{ blocks }] } });
    expect(preview.blocks).toHaveLength(PREVIEW_MAX_BLOCKS);
    expect(preview.truncated).toBe(true);
  });

  it("本文の HTML らしき文字はそのまま文字として持つ（画面は textContent で入れる）", () => {
    const preview = buildNotePreview({
      noteId: "n",
      doc: { pages: [{ blocks: [{ id: "a", type: "paragraph", content: [t("<img src=x onerror=alert(1)>")] }] }] },
    });
    expect(preview.blocks[0]).toMatchObject({ runs: [{ text: "<img src=x onerror=alert(1)>" }] });
  });
});
