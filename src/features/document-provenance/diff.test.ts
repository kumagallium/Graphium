import { describe, expect, it } from "vitest";
import { CONTENT_DIFF_MAX_CHARS, computeRevisionSummary } from "./diff";
import type { GraphiumPage } from "../../lib/document-types";

function page(blocks: any[]): GraphiumPage {
  return { blocks, labels: {}, provLinks: [], knowledgeLinks: [] } as any;
}
const t = (text: string, styles: any = {}) => ({ type: "text", text, styles });
const para = (content: any[], id = "b1") => ({ id, type: "paragraph", props: {}, content, children: [] });
const table = (rows: any[][], id = "t1", extra: any = {}) => ({
  id,
  type: "table",
  props: { textColor: "default" },
  content: { type: "tableContent", rows: rows.map((cells) => ({ cells })), ...extra },
  children: [],
});

describe("computeRevisionSummary: 正規化した content 全体で比べる", () => {
  it("MCP 形（セルが inline 配列）と BlockNote 形（tableCell・空 text 要素）は差分 0", () => {
    const mcp = table([[[t("A")], [t("B")]], [[t("1")], [t("2")]]]);
    const bn = table(
      [
        [
          { type: "tableCell", content: [t("A"), t("")], props: { colspan: 1, rowspan: 1, textColor: "default" } },
          { type: "tableCell", content: [t("B")], props: {} },
        ],
        [
          { type: "tableCell", content: [t("1")], props: {} },
          { type: "tableCell", content: [t("2", { tableRowIdentity: "row_x" })], props: {} },
        ],
      ],
      "t1",
      { columnWidths: [null, null], headerRows: 0 },
    );
    const s = computeRevisionSummary(page([mcp]), page([bn]));
    expect(s.blocksModified).toBe(0);
    expect(s.contentDiff).toBeUndefined();
  });

  it("隣接する同一 styles の text 分割は差分 0", () => {
    const s = computeRevisionSummary(
      page([para([t("ab", { bold: true })])]),
      page([para([t("a", { bold: true }), t("b", { bold: true })])]),
    );
    expect(s.blocksModified).toBe(0);
  });

  it("表セルだけの変更は blocksModified に入る", () => {
    const s = computeRevisionSummary(page([table([[[t("A")]]])]), page([table([[[t("B")]]])]));
    expect(s.blocksModified).toBe(1);
    expect(s.modifiedBlockIds).toEqual(["t1"]);
    expect(s.contentDiff?.[0]).toMatchObject({ type: "modify", before: "A", after: "B" });
  });

  it("inlineMath の latex だけの変更は blocksModified に入る", () => {
    const m = (latex: string) => para([t("x "), { type: "inlineMath", props: { latex } }]);
    const s = computeRevisionSummary(page([m("a^2")]), page([m("a^3")]));
    expect(s.blocksModified).toBe(1);
  });

  it("link の href だけの変更は blocksModified に入り contentDiff は出ない", () => {
    const l = (href: string) => para([{ type: "link", href, content: [t("here")] }]);
    const s = computeRevisionSummary(page([l("https://a.example")]), page([l("https://b.example")]));
    expect(s.blocksModified).toBe(1);
    expect(s.contentDiff).toBeUndefined();
  });

  it("styles だけの変更は blocksModified に入り contentDiff は出ない", () => {
    const s = computeRevisionSummary(
      page([para([t("abc")])]),
      page([para([t("abc", { bold: true })])]),
    );
    expect(s.blocksModified).toBe(1);
    expect(s.contentDiff).toBeUndefined();
  });

  it("テキスト変更は contentDiff に before/after が出る", () => {
    const s = computeRevisionSummary(page([para([t("a")])]), page([para([t("b")])]));
    expect(s.contentDiff).toEqual([{ blockId: "b1", type: "modify", before: "a", after: "b" }]);
  });
});

describe("computeRevisionSummary: 旧データ形と contentDiff の上限", () => {
  it("inlineImage の width 欠落と width:0 は差分 0（未編集で開いただけで版が立たない）", () => {
    const old = para([{ type: "inlineImage", props: { src: "a.png" } }]);
    const loaded = para([{ type: "inlineImage", props: { src: "a.png", width: 0 } }]);
    const s = computeRevisionSummary(page([old]), page([loaded]));
    expect(s.blocksModified).toBe(0);
    expect(s.contentDiff).toBeUndefined();
  });

  it("inline の props が実際に変われば差分になる（width: 0 → 200）", () => {
    const a = para([{ type: "inlineImage", props: { src: "a.png", width: 0 } }]);
    const b = para([{ type: "inlineImage", props: { src: "a.png", width: 200 } }]);
    expect(computeRevisionSummary(page([a]), page([b])).blocksModified).toBe(1);
  });

  it("contentDiff の text は 1 ブロック 2,000 字で切って末尾に「…」を付ける", () => {
    const long = "あ".repeat(CONTENT_DIFF_MAX_CHARS + 500);
    const added = computeRevisionSummary(null, page([para([t(long)])]));
    const after = added.contentDiff![0].after!;
    expect(after).toBe("あ".repeat(CONTENT_DIFF_MAX_CHARS) + "…");
    // ちょうど上限なら切らない
    const exact = "い".repeat(CONTENT_DIFF_MAX_CHARS);
    expect(computeRevisionSummary(null, page([para([t(exact)])])).contentDiff![0].after).toBe(exact);
    // modify の before / after も切る
    const mod = computeRevisionSummary(page([para([t(long)])]), page([para([t(long + "x")])]));
    expect(mod.blocksModified).toBe(1);
    for (const d of mod.contentDiff ?? []) {
      expect(d.before!.length).toBeLessThanOrEqual(CONTENT_DIFF_MAX_CHARS + 1);
      expect(d.after!.length).toBeLessThanOrEqual(CONTENT_DIFF_MAX_CHARS + 1);
    }
  });
});
