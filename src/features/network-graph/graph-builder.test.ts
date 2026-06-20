import { describe, it, expect } from "vitest";
import { buildNoteGraph } from "./graph-builder";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";

function file(id: string): GraphiumFile {
  return { id, name: `${id}.graphium.json`, modifiedTime: "", createdTime: "" };
}

describe("buildNoteGraph — 外部ソースとエッジ畳み込み", () => {
  it("Word(.docx) 由来 document: ソースを外部ノードとして表示する", () => {
    const docs = new Map<string, GraphiumDocument>([
      [
        "claim-1",
        {
          title: "知見",
          source: "ai",
          pages: [{ id: "p", title: "知見", blocks: [] }],
          wikiMeta: {
            kind: "claim",
            derivedFromNotes: ["document:doc-asset-1"],
            derivedFromChats: [],
          },
        } as unknown as GraphiumDocument,
      ],
    ]);
    const media: MediaIndex = {
      version: 2,
      updatedAt: "",
      media: [
        {
          fileId: "doc-asset-1",
          name: "20121128.docx",
          type: "document",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          url: "cdn://doc-asset-1",
          thumbnailUrl: "",
          uploadedAt: "",
          usedIn: [],
        },
      ],
    } as unknown as MediaIndex;

    const graph = buildNoteGraph("claim-1", [file("claim-1")], docs, media);
    const docNode = graph.nodes.find((n) => n.external === "document");
    expect(docNode).toBeDefined();
    expect(docNode!.title).toBe("20121128.docx");
    expect(graph.edges.some((e) => e.source === "document:doc-asset-1" && e.target === "claim-1")).toBe(true);
  });

  it("相互参照（A→B と B→A）を無向で 1 本に畳む", () => {
    // claim → atom（derivedFromClaims）と atom → claim（本文の knowledgeLinks 参照）の二重エッジ
    const docs = new Map<string, GraphiumDocument>([
      [
        "atom-1",
        {
          title: "洞察",
          source: "ai",
          pages: [
            {
              id: "p",
              title: "洞察",
              blocks: [],
              knowledgeLinks: [
                {
                  id: "kl",
                  sourceBlockId: "b",
                  targetBlockId: "",
                  targetNoteId: "claim-1",
                  type: "reference",
                  layer: "knowledge",
                  createdBy: "ai",
                },
              ],
            },
          ],
          wikiMeta: {
            kind: "atom",
            derivedFromNotes: [],
            derivedFromChats: [],
            derivedFromClaims: ["claim-1"],
          },
        } as unknown as GraphiumDocument,
      ],
      [
        "claim-1",
        {
          title: "知見",
          source: "ai",
          pages: [{ id: "p", title: "知見", blocks: [] }],
          wikiMeta: { kind: "claim", derivedFromNotes: [], derivedFromChats: [] },
        } as unknown as GraphiumDocument,
      ],
    ]);

    const graph = buildNoteGraph("atom-1", [file("atom-1"), file("claim-1")], docs, null);
    // atom-1 と claim-1 の間のエッジは 1 本だけ（無向で畳まれている）
    const between = graph.edges.filter(
      (e) =>
        (e.source === "atom-1" && e.target === "claim-1") ||
        (e.source === "claim-1" && e.target === "atom-1"),
    );
    expect(between.length).toBe(1);
  });

  it("自分自身を指す knowledgeLink で自己ループエッジを生成しない", () => {
    // 再生成でリネームされた知見が自分のタイトルを source 引用すると、
    // knowledgeLinks の targetNoteId が自分自身を指す自己参照リンクになる。
    const docs = new Map<string, GraphiumDocument>([
      [
        "claim-1",
        {
          title: "Al3V の 5% 合金化はフォノン散乱を増やして熱伝導率を下げる",
          source: "ai",
          pages: [
            {
              id: "p",
              title: "知見",
              blocks: [],
              knowledgeLinks: [
                {
                  id: "kl-self",
                  sourceBlockId: "b",
                  targetBlockId: "",
                  targetNoteId: "claim-1", // ← 自分自身を指す
                  type: "reference",
                  layer: "knowledge",
                  createdBy: "ai",
                },
              ],
            },
          ],
          wikiMeta: { kind: "claim", derivedFromNotes: [], derivedFromChats: [] },
        } as unknown as GraphiumDocument,
      ],
    ]);

    const graph = buildNoteGraph("claim-1", [file("claim-1")], docs, null);
    // 自己ループ（source === target）が 1 本も無いこと
    expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
  });
});
