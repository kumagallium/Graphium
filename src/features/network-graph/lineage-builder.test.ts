import { describe, it, expect } from "vitest";
import { buildLineageTree, type LineageNode } from "./lineage-builder";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import type { MediaIndex } from "../asset-browser/media-index";

// テスト用の最小ドキュメント生成
function note(_id: string, title: string): GraphiumDocument {
  return {
    title,
    source: "human",
    pages: [{ id: "p", title, blocks: [] }],
  } as unknown as GraphiumDocument;
}
function claim(_id: string, title: string, derivedFromNotes: string[]): GraphiumDocument {
  return {
    title,
    source: "ai",
    pages: [{ id: "p", title, blocks: [] }],
    wikiMeta: { kind: "claim", derivedFromNotes, derivedFromChats: [] },
  } as unknown as GraphiumDocument;
}
function file(id: string): GraphiumFile {
  return { id, name: `${id}.graphium.json`, modifiedTime: "", createdTime: "" };
}

function flatten(node: LineageNode | null): LineageNode[] {
  if (!node) return [];
  return [node, ...node.parents.flatMap(flatten)];
}

describe("buildLineageTree — 外部ソースの解決", () => {
  it("Word(.docx) 由来 document: ソースを来歴の末端ノードとして表示する（知見止まりにしない）", () => {
    // claim が document:<fileId>（Word 素材）から派生しているケース
    const docs = new Map<string, GraphiumDocument>([
      ["claim-1", claim("claim-1", "ある知見", ["document:doc-asset-1"])],
    ]);
    const files = [file("claim-1")];
    const media: MediaIndex = {
      version: 2,
      updatedAt: "",
      media: [
        {
          fileId: "doc-asset-1",
          name: "20121128.docx",
          type: "document",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          url: "cdn://doc-asset-1",
          thumbnailUrl: "",
          uploadedAt: "",
          usedIn: [],
        },
      ],
    } as unknown as MediaIndex;

    const tree = buildLineageTree("claim-1", files, docs, media);
    const nodes = flatten(tree);
    const docNode = nodes.find((n) => n.kind === "document");
    expect(docNode).toBeDefined();
    expect(docNode!.title).toBe("20121128.docx");
    expect(docNode!.externalUrl).toBe("cdn://doc-asset-1");
    // 修正前は document: が素 ID 扱いで黙って落ち、claim に親が無かった
    expect(tree!.parents.length).toBe(1);
  });

  it("chat: ソースも末端ノードとして表示する", () => {
    const docs = new Map<string, GraphiumDocument>([
      ["claim-1", claim("claim-1", "チャット由来の知見", ["chat:1779958597499"])],
    ]);
    const tree = buildLineageTree("claim-1", [file("claim-1")], docs, null);
    const chatNode = flatten(tree).find((n) => n.kind === "chat");
    expect(chatNode).toBeDefined();
  });

  it("通常ノート由来は従来どおり note ノードとして遡れる", () => {
    const docs = new Map<string, GraphiumDocument>([
      ["claim-1", claim("claim-1", "知見", ["note-1"])],
      ["note-1", note("note-1", "元ノート")],
    ]);
    const files = [file("claim-1"), file("note-1")];
    const tree = buildLineageTree("claim-1", files, docs, null);
    const noteNode = flatten(tree).find((n) => n.kind === "note");
    expect(noteNode?.title).toBe("元ノート");
  });
});
