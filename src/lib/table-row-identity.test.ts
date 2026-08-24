import { describe, expect, it } from "vitest";
import type { GraphiumDocument } from "./document-types";
import {
  extractTableCellText,
  normalizeTableRowIdentities,
  syncTableRowIdentitiesToEditor,
  TABLE_ROW_IDENTITY_STYLE,
} from "./table-row-identity";

const text = (value: string, styles: Record<string, string> = {}) => ({
  type: "text",
  text: value,
  styles,
});

const cell = (value: string, styles: Record<string, string> = {}) => ({
  type: "tableCell",
  content: [text(value, styles)],
});

function documentWithRows(rows: any[]): GraphiumDocument {
  return {
    version: 1,
    title: "行 identity",
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    pages: [{
      id: "page-1",
      title: "Main",
      labels: {},
      provLinks: [],
      knowledgeLinks: [],
      blocks: [{
        id: "table-1",
        type: "table",
        content: { type: "tableContent", rows },
        children: [],
      }],
    }],
  } as GraphiumDocument;
}

function identityAt(doc: GraphiumDocument, row: number): string | undefined {
  const cell = (doc.pages[0].blocks[0] as any).content.rows[row].cells[0];
  const content = Array.isArray(cell) ? cell : cell.content;
  return content[0].styles[TABLE_ROW_IDENTITY_STYLE];
}

describe("normalizeTableRowIdentities", () => {
  it("既存 ID を維持し、新規の非空行だけに ID を付ける", () => {
    const doc = documentWithRows([
      { cells: [cell("名前"), cell("量")] },
      { cells: [cell("Cu", { [TABLE_ROW_IDENTITY_STYLE]: "row_existing", bold: "true" }), cell("1g")] },
      { cells: [cell("Zn"), cell("2g")] },
      { cells: [cell(""), cell("")] },
    ]);

    const normalized = normalizeTableRowIdentities(doc);

    expect(identityAt(normalized, 0)).toBeUndefined();
    expect(identityAt(normalized, 1)).toBe("row_existing");
    expect(identityAt(normalized, 2)).toMatch(/^row_/);
    expect(identityAt(normalized, 3)).toBeUndefined();
    expect((normalized.pages[0].blocks[0] as any).content.rows[1].cells[0].content[0].styles.bold).toBe("true");
  });

  it("複製された ID は文書順で後の行だけを再採番し、旧 inline 配列も扱う", () => {
    const doc = documentWithRows([
      { cells: [cell("名前")] },
      { cells: [[text("A", { [TABLE_ROW_IDENTITY_STYLE]: "row_copied" })]] },
      { cells: [[text("B", { [TABLE_ROW_IDENTITY_STYLE]: "row_copied" })]] },
    ]);

    const normalized = normalizeTableRowIdentities(doc);

    expect(identityAt(normalized, 1)).toBe("row_copied");
    expect(identityAt(normalized, 2)).toMatch(/^row_/);
    expect(identityAt(normalized, 2)).not.toBe("row_copied");
  });

  it("リンク内テキストと画像 URL を行名として扱い identity を保持する", () => {
    const linkCell = {
      type: "tableCell",
      content: [{
        type: "link",
        href: "https://example.com/sample",
        content: [text("試料")],
      }],
    };
    const imageCell = {
      type: "tableCell",
      content: [{
        type: "image",
        props: { url: "https://example.com/image.png" },
      }],
    };
    const normalized = normalizeTableRowIdentities(documentWithRows([
      { cells: [cell("名前")] },
      { cells: [linkCell] },
      { cells: [imageCell] },
    ]));
    const rows = (normalized.pages[0].blocks[0] as any).content.rows;

    expect(extractTableCellText(rows[1].cells[0])).toBe("試料");
    expect(rows[1].cells[0].content[0].content[0].styles[TABLE_ROW_IDENTITY_STYLE]).toMatch(/^row_/);
    expect(extractTableCellText(rows[2].cells[0])).toBe("https://example.com/image.png");
    expect(rows[2].cells[0].content[0].styles[TABLE_ROW_IDENTITY_STYLE]).toMatch(/^row_/);
  });

  it("保存時に採番した identity をライブエディタへ戻し、次回も維持する", () => {
    const source = documentWithRows([
      { cells: [cell("名前")] },
      { cells: [cell("試料")] },
    ]);
    const editor = {
      document: source.pages[0].blocks,
      updateBlock(id: string, patch: { content: any }) {
        const block = this.document.find((candidate: any) => candidate.id === id);
        if (block) block.content = patch.content;
      },
    };

    const first = syncTableRowIdentitiesToEditor(editor);
    const firstIdentity = first[0].content.rows[1].cells[0].content[0].styles[TABLE_ROW_IDENTITY_STYLE];
    const second = syncTableRowIdentitiesToEditor(editor);
    const secondIdentity = second[0].content.rows[1].cells[0].content[0].styles[TABLE_ROW_IDENTITY_STYLE];

    expect(secondIdentity).toBe(firstIdentity);
  });
});
