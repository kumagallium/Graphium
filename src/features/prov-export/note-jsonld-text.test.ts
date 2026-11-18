// ノート 1 件の PROV 文字列（buildNoteProvJsonLdText）のテスト

import { describe, it, expect } from "vitest";
import { buildNoteProvJsonLdText } from "./note-jsonld-text";
import { buildProvJsonLdText } from "../../mcp/export-prov";
import type { GraphiumDocument } from "../../lib/document-types";

function heading(id: string, title: string) {
  return { id, type: "heading", props: { level: 2 }, content: [{ type: "text", text: title }], children: [] };
}

function makeDoc(): GraphiumDocument {
  return {
    title: "テスト",
    pages: [
      {
        id: "p",
        blocks: [heading("h1", "1. 焼く")],
        labels: { h1: "procedure" },
        provLinks: [
          { id: "l1", type: "informed_by", sourceBlockId: "h1", targetBlockId: "x", targetNoteId: "other", targetEntityId: "e" },
        ],
      },
    ],
  } as unknown as GraphiumDocument;
}

describe("buildNoteProvJsonLdText", () => {
  it("MCP の経路（buildProvJsonLdText）と同じ文字列になる", () => {
    const doc = makeDoc();
    const a = buildNoteProvJsonLdText(doc, "n1", { options: { includeBody: true, includeChats: false } });
    const b = buildProvJsonLdText(doc, "n1");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it("ページが無ければ null", () => {
    expect(buildNoteProvJsonLdText({ title: "x", pages: [] } as unknown as GraphiumDocument, "n1")).toBeNull();
  });

  it("題が空なら noteId を使う", () => {
    const doc = { ...makeDoc(), title: "  " } as GraphiumDocument;
    expect(buildNoteProvJsonLdText(doc, "n1")).toContain("n1");
  });
});
