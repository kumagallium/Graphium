// normalize-blocks.ts（Word 書き出し前のブロック正規化）のユニットテスト

import { describe, it, expect } from "vitest";
import { normalizeBlocksForDocx, STANDARD_BLOCK_TYPES } from "./normalize-blocks";

const text = (t: string, styles: Record<string, unknown> = {}) => ({ type: "text", text: t, styles });

describe("normalizeBlocksForDocx", () => {
  it("カスタムブロック（callout）が標準ブロックだけになる", () => {
    const out = normalizeBlocksForDocx([
      { id: "c1", type: "callout", props: { variant: "info" }, content: [text("注意")], children: [] },
    ]);
    expect(out.length).toBeGreaterThan(0);
    const walk = (bs: any[]) =>
      bs.forEach((b) => {
        expect(STANDARD_BLOCK_TYPES.has(b.type)).toBe(true);
        walk(b.children ?? []);
      });
    walk(out);
  });

  it("chart は docxChart になり、fallback に落とし込み結果を持つ", () => {
    const out = normalizeBlocksForDocx([
      { id: "chart-1", type: "chart", props: { config: "{}" }, children: [] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("docxChart");
    expect(out[0].blockId).toBe("chart-1");
    expect(Array.isArray(out[0].fallback)).toBe(true);
  });

  it("＠メンションと上付きはそのまま残る（[[題]] にも <sup> にもしない）", () => {
    const out = normalizeBlocksForDocx([
      {
        type: "paragraph",
        content: [
          text("@ノート題", { textColor: "blue" }),
          text("5", { superscript: true, inlineMaterial: "x" }),
        ],
        children: [],
      },
    ]);
    expect(out[0].content[0]).toEqual({ type: "text", text: "@ノート題", styles: { textColor: "blue" } });
    expect(out[0].content[1]).toEqual({ type: "text", text: "5", styles: { superscript: true } });
  });

  it("link は中身を再帰し、inlineMath は $…$ の text になり、inlineImage は残る", () => {
    const out = normalizeBlocksForDocx([
      {
        type: "paragraph",
        content: [
          { type: "link", href: "https://example.com", content: [text("a", { bold: true })] },
          { type: "inlineMath", props: { latex: "x^2" } },
          { type: "inlineImage", props: { fileId: "f1", name: "n.png", width: 50 } },
          { type: "unknownInline", text: "平文" },
          { type: "unknownInline2" },
        ],
        children: [],
      },
    ]);
    const c = out[0].content;
    expect(c[0].type).toBe("link");
    expect(c[0].content[0].styles).toEqual({ bold: true });
    expect(c[1]).toEqual({ type: "text", text: "$x^2$", styles: {} });
    expect(c[2]).toEqual({ type: "inlineImage", props: { fileId: "f1", name: "n.png", width: 50 } });
    expect(c[3]).toEqual({ type: "text", text: "平文", styles: {} });
    expect(c).toHaveLength(4);
  });

  it("未知の型は inline の文字だけの paragraph になる", () => {
    const out = normalizeBlocksForDocx([
      { type: "futureBlock", content: [text("あ"), text("い", { bold: true })], children: [] },
    ]);
    expect(out[0].type).toBe("paragraph");
    expect(out[0].content).toEqual([{ type: "text", text: "あい", styles: {} }]);
  });

  it("table のセルは両形式とも正規化される", () => {
    const out = normalizeBlocksForDocx([
      {
        type: "table",
        content: {
          type: "tableContent",
          rows: [
            { cells: [[text("a", { weird: 1 })], { type: "tableCell", props: { colspan: 2 }, content: [text("b")] }] },
          ],
        },
        children: [],
      },
    ]);
    const cells = out[0].content.rows[0].cells;
    expect(cells[0]).toEqual([{ type: "text", text: "a", styles: {} }]);
    expect(cells[1].props.colspan).toBe(2);
  });

  it("入れ子の children を再帰する", () => {
    const out = normalizeBlocksForDocx([
      { type: "paragraph", content: [], children: [{ type: "callout", content: [text("x")], children: [] }] },
    ]);
    expect(out[0].children.length).toBeGreaterThan(0);
  });

  it("壊れた入力で落ちない", () => {
    expect(normalizeBlocksForDocx(undefined)).toEqual([]);
    expect(normalizeBlocksForDocx({ a: 1 })).toEqual([]);
    expect(() => normalizeBlocksForDocx([null, 1, "x", { type: 5 }, { type: "table", content: 3 }, { type: "paragraph", content: [null, 4] }])).not.toThrow();
  });
});
