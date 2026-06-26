import { describe, it, expect } from "vitest";
import { buildGlobalGraph } from "./graph-builder";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { MediaIndex } from "../asset-browser/media-index";

// NoteIndexEntry の必須フィールドを埋めたうえで partial を上書きするヘルパー
function entry(partial: Partial<NoteIndexEntry> & { noteId: string }): NoteIndexEntry {
  return {
    title: partial.noteId,
    modifiedAt: "",
    createdAt: "",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...partial,
  } as NoteIndexEntry;
}

function index(notes: NoteIndexEntry[]): GraphiumIndex {
  return { version: 99, updatedAt: "", notes };
}

describe("buildGlobalGraph — インデックス起点の全ノードグラフ", () => {
  it("孤立ノートを含む全エントリをノード化し、ゴミ箱・アーカイブは除外する", () => {
    const g = buildGlobalGraph(
      index([
        entry({ noteId: "n1", title: "ノートA" }),
        entry({ noteId: "n2", title: "孤立ノート" }), // エッジ無しでもノードになる
        entry({ noteId: "trashed", deletedAt: "2026-01-01" }),
        entry({ noteId: "archived", archivedAt: "2026-01-01" }),
      ]),
    );
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["n1", "n2"]);
    expect(g.nodes.find((n) => n.id === "n2")).toBeDefined(); // 孤立ノートも残る
  });

  it("outgoingLinks の層を relation に対応づける（prov=派生 / knowledge=参照）", () => {
    const g = buildGlobalGraph(
      index([
        entry({
          noteId: "n1",
          outgoingLinks: [
            { targetNoteId: "n2", layer: "prov" },
            { targetNoteId: "n3", layer: "knowledge" },
          ],
        }),
        entry({ noteId: "n2" }),
        entry({ noteId: "n3" }),
      ]),
    );
    const derived = g.edges.find((e) => e.target === "n2");
    const reference = g.edges.find((e) => e.target === "n3");
    expect(derived?.relation).toBe("derived");
    expect(reference?.relation).toBe("reference");
  });

  it("存在しない（除外された）ノートへのリンクは捨てる", () => {
    const g = buildGlobalGraph(
      index([
        entry({ noteId: "n1", outgoingLinks: [{ targetNoteId: "ghost", layer: "prov" }] }),
      ]),
    );
    expect(g.edges).toHaveLength(0);
  });

  it("Wiki の derivedFromNotes: 外部ソースは used エッジ＋外部ノード、通常ノートは derived", () => {
    const media: MediaIndex = {
      version: 2,
      updatedAt: "",
      media: [
        { fileId: "pdf-1", name: "論文.pdf", type: "pdf", mimeType: "application/pdf", url: "cdn://pdf-1", thumbnailUrl: "", uploadedAt: "", usedIn: [] },
      ],
    } as unknown as MediaIndex;

    const g = buildGlobalGraph(
      index([
        entry({ noteId: "note-1" }),
        entry({
          noteId: "wiki-1",
          source: "ai",
          wikiKind: "claim",
          derivedFromNotes: ["pdf:pdf-1", "note-1"],
        }),
      ]),
      media,
    );

    // 外部ノード（pdf）が作られ、名前が media から解決される
    const pdfNode = g.nodes.find((n) => n.external === "pdf");
    expect(pdfNode).toBeDefined();
    expect(pdfNode!.title).toBe("論文.pdf");

    // 外部ソース → wiki は used
    const usedEdge = g.edges.find((e) => e.source === "pdf:pdf-1" && e.target === "wiki-1");
    expect(usedEdge?.relation).toBe("used");

    // 通常ノート → wiki は derived
    const derivedEdge = g.edges.find((e) => e.source === "note-1" && e.target === "wiki-1");
    expect(derivedEdge?.relation).toBe("derived");

    // wiki ノードは isWiki / wikiKind を持つ
    const wikiNode = g.nodes.find((n) => n.id === "wiki-1");
    expect(wikiNode?.isWiki).toBe(true);
    expect(wikiNode?.wikiKind).toBe("claim");
  });

  it("同じノードペアの多重エッジは relation 優先度（derived > reference）で 1 本に畳む", () => {
    const g = buildGlobalGraph(
      index([
        // n1 → n2 を派生（prov）で、n2 → n1 を参照（knowledge）で張る＝無向で同一ペア
        entry({ noteId: "n1", outgoingLinks: [{ targetNoteId: "n2", layer: "prov" }] }),
        entry({ noteId: "n2", outgoingLinks: [{ targetNoteId: "n1", layer: "knowledge" }] }),
      ]),
    );
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].relation).toBe("derived"); // 優先度の高い derived が残る
  });
});
