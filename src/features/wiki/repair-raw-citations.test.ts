import { describe, it, expect } from "vitest";
import { repairRawTitleCitations } from "./repair-raw-citations";
import { migrateToLatest } from "../../lib/document-migration";

const TITLE = "[第三部] ループのボトルネックは、人間だ ｜稲見 昌彦";

/** v0.173.8 までに作られた、題に [ ] を含む資料を引く要約ページの形 */
function brokenSummary(extraText?: string): any {
  return {
    version: 6,
    title: "要約",
    source: "ai",
    wikiMeta: { kind: "summary" },
    pages: [
      {
        id: "p",
        title: "要約",
        blocks: [
          { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "概要", styles: {} }], children: [] },
          {
            id: "b1",
            type: "paragraph",
            props: {},
            content: [{ type: "text", text: `考察する資料である[[${TITLE}]]。${extraText ?? ""}`, styles: {} }],
            children: [],
          },
          { id: "h2", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "References", styles: {} }], children: [] },
          {
            id: "r1",
            type: "bulletListItem",
            props: {},
            content: [{ type: "text", text: `@${TITLE}`, styles: { textColor: "blue" } }],
            children: [],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [
          { id: "k1", sourceBlockId: "r1", targetBlockId: "", targetNoteId: "note-42", type: "reference", layer: "knowledge", createdBy: "ai" },
        ],
      },
    ],
  };
}

describe("repairRawTitleCitations", () => {
  it("生の [[題]] を References の資料への @リンクに戻し、リンク記録を足す", () => {
    const doc = brokenSummary();
    repairRawTitleCitations(doc);
    const para = doc.pages[0].blocks[1];
    expect(para.content).toEqual([
      { type: "text", text: "考察する資料である", styles: {} },
      { type: "text", text: `@${TITLE}`, styles: { textColor: "blue" } },
      { type: "text", text: "。", styles: {} },
    ]);
    const added = doc.pages[0].knowledgeLinks.filter((l: any) => l.sourceBlockId === "b1");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ targetNoteId: "note-42", type: "reference", layer: "knowledge", createdBy: "ai" });
  });

  it("2 度目は何もしない（冪等）", () => {
    const doc = brokenSummary();
    repairRawTitleCitations(doc);
    const once = JSON.stringify(doc);
    repairRawTitleCitations(doc);
    expect(JSON.stringify(doc)).toBe(once);
  });

  it("References に無い題の引用と、一節の目印つきの引用", () => {
    const doc = brokenSummary(`別の資料[[知らない資料]]。目印つき[[${TITLE}⟦P:0⟧]]`);
    repairRawTitleCitations(doc);
    const texts = doc.pages[0].blocks[1].content.map((c: any) => c.text);
    expect(texts.join("")).toContain("[[知らない資料]]");
    expect(texts.filter((t: string) => t === `@${TITLE}`)).toHaveLength(2);
    expect(texts.join("")).not.toContain("⟦P:");
  });

  it("普通のノート（wikiMeta なし）には触らない", () => {
    const doc = brokenSummary();
    delete doc.wikiMeta;
    const before = JSON.stringify(doc);
    repairRawTitleCitations(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("読み込み（migrateToLatest）で直る", () => {
    const doc = migrateToLatest(brokenSummary(), "self-id");
    expect(doc.pages[0].blocks[1].content.some((c: any) => c.text === `@${TITLE}`)).toBe(true);
  });
});
