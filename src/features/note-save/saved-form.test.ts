// buildSavedForm の単体テスト（no-write-on-open の土台）
//
// 「除いた項目（modifiedAt・driveRevisionId）だけの違いは同じ」「それ以外の違いは
// 違う」「キー順序・undefined キーの違いに依らない」「配列の順序は意味を持つ」を
// 固定する。

import { describe, it, expect } from "vitest";
import { buildSavedForm } from "./saved-form";
import type { GraphiumDocument } from "../../lib/document-types";

function baseDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 6,
    title: "ノート",
    pages: [
      {
        id: "main",
        title: "ノート",
        blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "hello", styles: {} }] }],
        labels: { b1: "procedure" },
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    createdAt: "2026-09-25T00:00:00.000Z",
    modifiedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  } as unknown as GraphiumDocument;
}

describe("buildSavedForm", () => {
  it("modifiedAt だけが違う doc は同じ形とみなす", () => {
    const a = baseDoc({ modifiedAt: "2026-09-25T00:00:00.000Z" });
    const b = baseDoc({ modifiedAt: "2026-09-29T12:34:56.000Z" });
    expect(buildSavedForm(a)).toBe(buildSavedForm(b));
  });

  it("documentProvenance.revisions[].driveRevisionId だけが違う doc は同じ形とみなす", () => {
    const provenanceOf = (driveRevisionId?: string) => ({
      revisions: [
        {
          id: "rev-1",
          savedAt: "2026-09-25T00:00:00.000Z",
          driveRevisionId,
          summary: {
            blocksAdded: 0,
            blocksRemoved: 0,
            blocksModified: 0,
            labelsChanged: [],
            provLinksAdded: 0,
            provLinksRemoved: 0,
            knowledgeLinksAdded: 0,
            knowledgeLinksRemoved: 0,
          },
          contentHash: "hash-1",
          wasGeneratedBy: "edit-1",
        },
      ],
      activities: [],
      agents: [],
    });
    const a = baseDoc({ documentProvenance: provenanceOf(undefined) as any });
    const b = baseDoc({ documentProvenance: provenanceOf("drive-rev-123") as any });
    expect(buildSavedForm(a)).toBe(buildSavedForm(b));
  });

  it("本文（blocks）が違う doc は違う形とみなす", () => {
    const a = baseDoc();
    const b = baseDoc({
      pages: [
        {
          id: "main",
          title: "ノート",
          blocks: [{ id: "b1", type: "paragraph", content: [{ type: "text", text: "changed", styles: {} }] }],
          labels: { b1: "procedure" },
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
    expect(buildSavedForm(a)).not.toBe(buildSavedForm(b));
  });

  it("ラベル・リンク・表の注釈・画像のラベル・配置・OCR・来歴・共有情報のどれが違っても違う形とみなす", () => {
    const a = baseDoc();
    const variants: Array<Partial<GraphiumDocument>> = [
      { pages: [{ ...a.pages[0], labels: { b1: "material" } }] },
      { pages: [{ ...a.pages[0], provLinks: [{ sourceBlockId: "b1", targetBlockId: "b2", type: "uses", layer: "prov" } as any] }] },
      { pages: [{ ...a.pages[0], tableMeta: { b1: { columnTypes: {} } } as any }] },
      { pages: [{ ...a.pages[0], mediaInlineLabels: { m1: "foo" } as any }] },
      { pages: [{ ...a.pages[0], blockAlignments: { b1: "center" } }] },
      { pages: [{ ...a.pages[0], mediaOcr: { m1: "ocr text" } as any }] },
      { sharedRef: { id: "s1", type: "note", sharedAt: "2026-09-25T00:00:00.000Z", hash: "h1" } },
      { noteContexts: ["eureco"] },
      { fullWidth: true },
    ];
    for (const variant of variants) {
      const b = baseDoc(variant);
      expect(buildSavedForm(a)).not.toBe(buildSavedForm(b));
    }
  });

  it("キーの順序・undefined キーの有無は違いとみなさない", () => {
    const a: GraphiumDocument = {
      version: 6,
      title: "ノート",
      createdAt: "2026-09-25T00:00:00.000Z",
      modifiedAt: "2026-09-25T00:00:00.000Z",
      fullWidth: undefined,
      pages: [{ id: "main", title: "ノート", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    } as unknown as GraphiumDocument;
    const b: GraphiumDocument = {
      pages: [{ knowledgeLinks: [], provLinks: [], labels: {}, blocks: [], title: "ノート", id: "main" }],
      modifiedAt: "2026-09-25T00:00:00.000Z",
      title: "ノート",
      createdAt: "2026-09-25T00:00:00.000Z",
      version: 6,
    } as unknown as GraphiumDocument;
    expect(buildSavedForm(a)).toBe(buildSavedForm(b));
  });

  it("配列の順序は意味を持つのでそのまま比べる（chats の並びが違えば違う形）", () => {
    const a = baseDoc({ chats: [{ id: "c1" } as any, { id: "c2" } as any] });
    const b = baseDoc({ chats: [{ id: "c2" } as any, { id: "c1" } as any] });
    expect(buildSavedForm(a)).not.toBe(buildSavedForm(b));
  });
});
