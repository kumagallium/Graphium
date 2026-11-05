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

  it("memo: ソースも末端ノードとして表示する", () => {
    const docs = new Map<string, GraphiumDocument>([
      ["claim-1", claim("claim-1", "メモ由来の知見", ["memo:cap_1753000000000_ab12"])],
    ]);
    const tree = buildLineageTree("claim-1", [file("claim-1")], docs, null);
    const memoNode = flatten(tree).find((n) => n.kind === "memo");
    expect(memoNode).toBeDefined();
    expect(memoNode!.title).toBe("Memo");
    // 外部ソースは末端ノード（これ以上遡らない）
    expect(memoNode!.parents.length).toBe(0);
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

// 系譜（親子）には派生の線だけを入れる。本文の @ でつないだだけのノートは向きが無いので出さない
describe("buildLineageTree — 本文の @ のつながりは系譜に入れない", () => {
  const link = (targetNoteId: string) => ({ targetNoteId, sourceBlockId: "b1", type: "derived_from" as const });

  it("@ で引かれたノートの親に、引いたノートを出さない（派生の親は出す）", () => {
    const docs = new Map<string, GraphiumDocument>([
      ["late", { ...note("late", "10/19 の回"), noteLinks: [link("early")] }],
      ["early", note("early", "9/24 の回")],
      ["proto", { ...note("proto", "試作 5"), noteLinks: [link("kid")] }],
      ["kid", { ...note("kid", "試作 6"), derivedFromNoteId: "proto" }],
    ]);
    const files = ["late", "early", "proto", "kid"].map(file);

    const fromEarly = buildLineageTree("early", files, docs);
    expect(fromEarly?.parents).toEqual([]);

    const fromKid = buildLineageTree("kid", files, docs);
    expect(fromKid?.parents.map((p) => p.id)).toEqual(["proto"]);
    expect(fromKid?.parents[0].relations).toEqual(expect.arrayContaining(["derivedFrom", "noteLink"]));
  });
});
