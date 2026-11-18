import { describe, it, expect } from "vitest";
import { buildNoteGraph } from "./graph-builder";
import { buildLineageTree, type LineageNode } from "./lineage-builder";
import { classifyNodeTap } from "./external-source";
import { graphNodeIconKind } from "./graph-node-icon";
import { buildW3CProvJsonLd, type WikiEntityInfo } from "../prov-export/export-jsonld";
import type { ProvJsonLd } from "../prov-generator";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";

// AI との会話の素材（conversation:<fileId>）を、document: と同じ扱いで受けられることの確認。
const FILE_ID = "conv-claude-code-11111111-2222-4333-8444-555555555555";
const SOURCE_ID = `conversation:${FILE_ID}`;
const TITLE = "全粒粉は 2 割までにする";

function file(id: string): GraphiumFile {
  return { id, name: `${id}.graphium.json`, modifiedTime: "", createdTime: "" };
}

function claim(derivedFromNotes: string[]): GraphiumDocument {
  return {
    title: "全粒粉の配合",
    source: "ai",
    pages: [{ id: "p", title: "全粒粉の配合", blocks: [] }],
    wikiMeta: { kind: "claim", derivedFromNotes, derivedFromChats: [] },
  } as unknown as GraphiumDocument;
}

function mediaWithConversation(usedIn: string[] = []): MediaIndex {
  return {
    version: 2,
    updatedAt: "",
    media: [
      {
        fileId: FILE_ID,
        name: TITLE,
        type: "conversation",
        mimeType: "text/markdown",
        url: "",
        thumbnailUrl: "",
        uploadedAt: "",
        usedIn: usedIn.map((noteId) => ({ noteId })),
      },
    ],
  } as unknown as MediaIndex;
}

function flatten(node: LineageNode | null): LineageNode[] {
  if (!node) return [];
  return [node, ...node.parents.flatMap(flatten)];
}

describe("conversation: 出典（document: と同じ扱い）", () => {
  it("近接グラフ: 素材の一覧から題を引き、素材として開ける外部ノードにする", () => {
    const docs = new Map([["claim-1", claim([SOURCE_ID])]]);
    const graph = buildNoteGraph("claim-1", [file("claim-1")], docs, mediaWithConversation());
    const node = graph.nodes.find((n) => n.external === "conversation");
    expect(node).toBeDefined();
    expect(node!.id).toBe(SOURCE_ID);
    expect(node!.title).toBe(TITLE);
    expect(node!.mediaFileId).toBe(FILE_ID);
    expect(graph.edges.some((e) => e.source === SOURCE_ID && e.target === "claim-1")).toBe(true);
  });

  it("近接グラフ: 素材の一覧に無いときの題は AI conversation", () => {
    const docs = new Map([["claim-1", claim([SOURCE_ID])]]);
    const graph = buildNoteGraph("claim-1", [file("claim-1")], docs, null);
    expect(graph.nodes.find((n) => n.external === "conversation")!.title).toBe("AI conversation");
  });

  it("近接グラフ: usedIn の conversation 素材を conversation: ノードとして出す", () => {
    const docs = new Map<string, GraphiumDocument>([
      [
        "note-1",
        { title: "Note", source: "user", pages: [{ id: "p", title: "Note", blocks: [] }] } as unknown as GraphiumDocument,
      ],
    ]);
    const graph = buildNoteGraph("note-1", [file("note-1")], docs, mediaWithConversation(["note-1"]));
    const node = graph.nodes.find((n) => n.external === "conversation");
    expect(node).toBeDefined();
    expect(node!.id).toBe(SOURCE_ID);
    expect(node!.title).toBe(TITLE);
  });

  it("来歴の木: 末端ノードの種類は conversation で、題を素材の一覧から引く", () => {
    const docs = new Map([["claim-1", claim([SOURCE_ID])]]);
    const tree = buildLineageTree("claim-1", [file("claim-1")], docs, mediaWithConversation());
    const node = flatten(tree).find((n) => n.kind === "conversation");
    expect(node).toBeDefined();
    expect(node!.title).toBe(TITLE);
    expect(tree!.parents.length).toBe(1);
  });

  it("クリックの振り分けとアイコン: 来歴の起点にせず開く・見た目は document と同じ", () => {
    expect(classifyNodeTap(SOURCE_ID, { hasSelect: true })).toBe("open");
    expect(graphNodeIconKind({ external: "conversation" })).toBe(graphNodeIconKind({ external: "document" }));
  });

  it("PROV 書き出し: 型付きの外部ソースノードにし、graphium:note/conversation:… を作らない", () => {
    const emptyProv = { "@context": {}, "@graph": [] } as unknown as ProvJsonLd;
    const wiki: WikiEntityInfo = {
      title: "全粒粉の配合",
      kind: "claim",
      status: "active",
      generatedAt: "2026-11-18T00:00:00Z",
      model: "m",
      derivedFromNotes: [SOURCE_ID],
    };
    const doc = buildW3CProvJsonLd(emptyProv, "n", [wiki]);
    const used = doc["@graph"]
      .filter((n: any) => n["@type"] === "Derivation")
      .map((d: any) => d.usedEntity);
    expect(used).toEqual([`graphium:conversation/${FILE_ID}`]);
  });
});
