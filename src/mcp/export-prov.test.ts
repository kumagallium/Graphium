// export-prov.ts（export_prov の本体）の回帰テスト。

import { describe, expect, it } from "vitest";

import type { GraphiumDocument } from "../lib/document-types";
import { buildProvJsonLdText } from "./export-prov";

function heading(id: string, title: string) {
  return { id, type: "heading", props: { level: 2 }, content: [{ type: "text", text: title }], children: [] };
}

describe("buildProvJsonLdText", () => {
  it("@context と手順の Activity を含む JSON-LD を返す", () => {
    const doc = {
      title: "テスト",
      pages: [{ id: "p", blocks: [heading("h1", "1. 焼く")], labels: { h1: "procedure" }, provLinks: [] }],
    } as unknown as GraphiumDocument;
    const text = buildProvJsonLdText(doc, "n1")!;
    const parsed = JSON.parse(text);
    expect(parsed["@context"]).toBeDefined();
    expect(text).toContain("焼く");
  });

  it("他ノートへの informed_by は外部の参照として出る", () => {
    const doc = {
      title: "テスト",
      pages: [
        {
          id: "p",
          blocks: [heading("h1", "1. 焼く")],
          labels: { h1: "procedure" },
          provLinks: [
            { id: "l", sourceBlockId: "h1", targetBlockId: "x", targetNoteId: "other-note", targetEntityId: "ent1", type: "informed_by", layer: "prov", createdBy: "human" },
          ],
        },
      ],
    } as unknown as GraphiumDocument;
    expect(buildProvJsonLdText(doc, "n1")).toContain("other-note");
  });

  it("ページが無ければ null", () => {
    expect(buildProvJsonLdText({ title: "空", pages: [] } as unknown as GraphiumDocument, "n")).toBeNull();
  });
});
