import { describe, expect, it } from "vitest";
import { extractWikiSections } from "./section-extract";
import type { GraphiumDocument } from "../../lib/document-types";

function wikiDoc(blocks: any[]): GraphiumDocument {
  return {
    version: 2,
    title: "焼結の知見",
    pages: [{ id: "p1", title: "Main", blocks, labels: {}, provLinks: [], knowledgeLinks: [] }],
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: "2026-01-01T00:00:00Z",
      generatedBy: { model: "m", version: "1.0.0" },
    },
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-01-01T00:00:00Z",
  } as GraphiumDocument;
}

const link = (text: string) => ({
  type: "link",
  href: "https://example.com/paper",
  content: [{ type: "text", text, styles: {} }],
});

describe("extractWikiSections", () => {
  it("リンクは中身の文字にする（[object Object] にしない）", () => {
    const sections = extractWikiSections(
      "w1",
      wikiDoc([
        { id: "lead", type: "paragraph", content: [{ type: "text", text: "詳細は ", styles: {} }, link("原論文"), { type: "text", text: " を参照。", styles: {} }] },
        { id: "h", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "根拠", styles: {} }] },
        { id: "b", type: "paragraph", content: [link("Smith 2020")] },
      ]),
    );
    expect(sections).toEqual([
      { documentId: "w1", sectionId: "lead", text: "claim: 焼結の知見: 詳細は 原論文 を参照。" },
      { documentId: "w1", sectionId: "h", text: "claim: 焼結の知見 > 根拠: Smith 2020" },
    ]);
  });

  it("インライン数式は $…$ で残し、上付き・下付きはタグを入れない（索引のキーなので平文）", () => {
    const sections = extractWikiSections(
      "w1",
      wikiDoc([
        {
          id: "lead",
          type: "paragraph",
          content: [
            { type: "text", text: "10", styles: {} },
            { type: "text", text: "5", styles: { superscript: true } },
            { type: "text", text: " Pa で ", styles: {} },
            { type: "inlineMath", props: { latex: "\\Delta G < 0" } },
          ],
        },
      ]),
    );
    expect(sections.map((s) => s.text)).toEqual(["claim: 焼結の知見: 105 Pa で $\\Delta G < 0$"]);
  });

  it("表（セルが inline 配列の形）の中のリンクも文字にする", () => {
    const sections = extractWikiSections(
      "w1",
      wikiDoc([
        {
          id: "t",
          type: "table",
          content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "出典", styles: {} }], [link("DOI")]] }] },
        },
      ]),
    );
    expect(sections.map((s) => s.text)).toEqual(["claim: 焼結の知見: 出典 DOI"]);
  });
});
