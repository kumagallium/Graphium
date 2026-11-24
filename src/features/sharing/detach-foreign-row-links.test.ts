import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "../../lib/document-types";
import { detachForeignRowLinks } from "./detach-foreign-row-links";
import { collectOperationRows } from "../network-graph/plan-flow";

const cell = (text: string, styles: Record<string, unknown> = {}) => ({
  type: "tableCell",
  props: { backgroundColor: "default" },
  content: [{ type: "text", text, styles }],
});

function planDoc(noteLinks: Record<string, string>): GraphiumDocument {
  return {
    version: 3,
    title: "食パンの計画",
    kind: "plan",
    noteLinks: [
      { targetNoteId: "teacher-knead", sourceBlockId: "tbl-1", type: "derived_from" },
      { targetNoteId: "mine", sourceBlockId: "tbl-1", type: "derived_from" },
    ],
    pages: [
      {
        id: "main",
        title: "Main",
        blocks: [
          {
            id: "wrap",
            type: "paragraph",
            content: [],
            children: [
              {
                id: "tbl-1",
                type: "table",
                content: {
                  type: "tableContent",
                  columnWidths: [120, 80],
                  rows: [
                    { cells: [cell("工程"), cell("条件")] },
                    { cells: [cell("@こね", { textColor: "blue", tableRowIdentity: "row_a" }), cell("10 分")] },
                    { cells: [cell("@一次発酵", { textColor: "blue", tableRowIdentity: "row_b" }), cell("60 分")] },
                    { cells: [cell("焼成", { tableRowIdentity: "row_c" }), cell("200 ℃")] },
                  ],
                },
                children: [],
              },
            ],
          },
        ],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        tableMeta: { "tbl-1": { caption: "工程表", columns: { 工程: ["note-link"] }, noteLinks } },
      },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    modifiedAt: "2026-11-01T00:00:00.000Z",
  } as unknown as GraphiumDocument;
}

const firstCells = (doc: GraphiumDocument) =>
  ((doc.pages[0].blocks[0] as any).children[0].content.rows as any[]).slice(1).map((r) => r.cells[0].content[0]);

describe("detachForeignRowLinks", () => {
  it("この端末に無いノートへの行のつながりを外し、セルの @ と青い文字を解く", () => {
    const doc = planDoc({ こね: "teacher-knead", "@こね": "teacher-knead", "@一次発酵": "teacher-ferment" });
    const out = detachForeignRowLinks(doc, () => false);

    expect(out.pages[0].tableMeta?.["tbl-1"]).toEqual({ caption: "工程表", columns: { 工程: ["note-link"] } });
    expect(firstCells(out)).toEqual([
      { type: "text", text: "こね", styles: { tableRowIdentity: "row_a" } },
      { type: "text", text: "一次発酵", styles: { tableRowIdentity: "row_b" } },
      { type: "text", text: "焼成", styles: { tableRowIdentity: "row_c" } },
    ]);
    // 行はどれも「未作成」になり、行からノートを作れる
    expect(collectOperationRows(out).map((r) => [r.name, r.state, r.rowId])).toEqual([
      ["こね", "unlinked", "row_a"],
      ["一次発酵", "unlinked", "row_b"],
      ["焼成", "unlinked", "row_c"],
    ]);
    // 外したノートへの線は文書の noteLinks からも外れる
    expect(out.noteLinks?.map((l) => l.targetNoteId)).toEqual(["mine"]);
  });

  it("表のほかの中身（列幅・ほかのセル・セルの書式）は変えない", () => {
    const doc = planDoc({ "@こね": "teacher-knead" });
    const out = detachForeignRowLinks(doc, () => false);
    const table = (out.pages[0].blocks[0] as any).children[0];
    expect(table.content.columnWidths).toEqual([120, 80]);
    expect(table.content.rows[1].cells[0].props).toEqual({ backgroundColor: "default" });
    expect(table.content.rows[1].cells[1]).toBe((doc.pages[0].blocks[0] as any).children[0].content.rows[1].cells[1]);
    // つながっていなかった行（@ 付きのまま残した行）は触らない
    expect(table.content.rows[2]).toBe((doc.pages[0].blocks[0] as any).children[0].content.rows[2]);
  });

  it("この端末にあるノートへのつながりは残す（自分の共有ノートを自分で写したとき）", () => {
    const doc = planDoc({ "@こね": "mine", "@一次発酵": "teacher-ferment" });
    const out = detachForeignRowLinks(doc, (id) => id === "mine");
    expect(out.pages[0].tableMeta?.["tbl-1"].noteLinks).toEqual({ "@こね": "mine" });
    expect(firstCells(out)[0]).toEqual({
      type: "text",
      text: "@こね",
      styles: { textColor: "blue", tableRowIdentity: "row_a" },
    });
    expect(firstCells(out)[1].text).toBe("一次発酵");
  });

  it("外すものが無ければ、受け取った doc をそのまま返す", () => {
    const doc = planDoc({ "@こね": "mine" });
    expect(detachForeignRowLinks(doc, () => true)).toBe(doc);
    const noLinks = planDoc({});
    expect(detachForeignRowLinks(noLinks, () => false)).toBe(noLinks);
  });

  it("引数の doc は変更しない", () => {
    const doc = planDoc({ "@こね": "teacher-knead" });
    const before = JSON.stringify(doc);
    detachForeignRowLinks(doc, () => false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("旧形式（indexTables）の行のつながりも外す", () => {
    const doc = planDoc({});
    const page = doc.pages[0] as any;
    delete page.tableMeta;
    page.indexTables = { "tbl-1": { "@こね": "teacher-knead" } };
    const out = detachForeignRowLinks(doc, () => false);
    expect(out.pages[0].tableMeta?.["tbl-1"].noteLinks).toBeUndefined();
    expect(firstCells(out)[0].text).toBe("こね");
  });
});
