import { describe, it, expect, beforeEach } from "vitest";
import {
  isDocumentNote,
  docMediaFileId,
  blocksToPlainText,
  gatherDerivedMemos,
  gatherDerivedKnowledge,
  formatCitedDocument,
  assembleCitedDocumentContext,
  assembleCitedAssetContext,
  __clearPdfTextCacheForTest,
} from "./cited-document-context";
import type { GraphiumDocument } from "../../lib/document-types";
import type { GraphiumIndex } from "../navigation/index-file";
import type { CaptureIndex } from "../mobile-capture/capture-store";

function makePage(blocks: any[], title = "Doc"): any {
  return { id: "p1", title, blocks, labels: [], provLinks: [], knowledgeLinks: [] };
}

function makeDoc(partial: Partial<GraphiumDocument>): GraphiumDocument {
  return {
    version: 5,
    title: "Doc",
    pages: [makePage([])],
    ...partial,
  } as GraphiumDocument;
}

describe("isDocumentNote / docMediaFileId", () => {
  it("PDF 由来ノートを文書ノートと判定", () => {
    const doc = makeDoc({ sourcePdfFileId: "pdf-1" });
    expect(isDocumentNote(doc)).toBe(true);
    expect(docMediaFileId(doc)).toBe("pdf-1");
  });

  it("URL 由来ノートは文書ノートだがメディア fileId を持たない", () => {
    const doc = makeDoc({ sourceUrl: "https://example.com" });
    expect(isDocumentNote(doc)).toBe(true);
    expect(docMediaFileId(doc)).toBeUndefined();
  });

  it("通常ノートは文書ノートではない", () => {
    expect(isDocumentNote(makeDoc({}))).toBe(false);
  });
});

describe("blocksToPlainText", () => {
  it("見出しと段落をテキスト化する", () => {
    const doc = makeDoc({
      pages: [
        makePage([
          { type: "heading", props: { level: 2 }, content: [{ text: "見出し" }] },
          { type: "paragraph", content: [{ text: "本文です" }] },
        ], "t"),
      ],
    });
    expect(blocksToPlainText(doc)).toBe("## 見出し\n本文です");
  });
});

describe("gatherDerivedMemos", () => {
  const captureIndex: CaptureIndex = {
    version: 1,
    updatedAt: "now",
    captures: [
      { id: "m1", text: "抜書きA", createdAt: "t", sourceAsset: { fileId: "pdf-1", type: "pdf" } },
      { id: "m2", text: "別素材", createdAt: "t", sourceAsset: { fileId: "pdf-x", type: "pdf" } },
      { id: "m3", text: "ノート由来", createdAt: "t", sourceNote: { fileId: "note-1" } },
      { id: "m4", text: "無関係", createdAt: "t" },
    ],
  };

  it("sourceAsset.fileId 一致 と sourceNote.fileId 一致を OR で拾う", () => {
    const got = gatherDerivedMemos(captureIndex, "pdf-1", "note-1").map((m) => m.id);
    expect(got).toEqual(["m1", "m3"]);
  });

  it("captureIndex が null なら空", () => {
    expect(gatherDerivedMemos(null, "pdf-1", "note-1")).toEqual([]);
  });
});

describe("gatherDerivedKnowledge", () => {
  const noteIndex = {
    notes: [
      { noteId: "k1", title: "洞察1", source: "ai", derivedFromNotes: ["note-1"] },
      { noteId: "k2", title: "別由来", source: "ai", derivedFromNotes: ["note-9"] },
      { noteId: "k3", title: "人間ノート", source: "human", derivedFromNotes: ["note-1"] },
    ],
  } as unknown as GraphiumIndex;

  it("AI ノートで derivedFromNotes に当ノートを含むものだけ", () => {
    const got = gatherDerivedKnowledge(noteIndex, "note-1").map((n) => n.noteId);
    expect(got).toEqual(["k1"]);
  });
});

describe("formatCitedDocument", () => {
  it("メモ・知見・原文を順に並べる", () => {
    const md = formatCitedDocument({
      title: "論文X",
      mediumLabel: "PDF",
      memos: ["抜書き1", "抜書き2"],
      knowledge: [{ title: "洞察A", text: "AはBである" }],
      fullText: "これは原文の本文です。",
    });
    expect(md).toContain("## 引用文書: 論文X（PDF）");
    expect(md).toContain("### あなたの派生メモ（2件）");
    expect(md).toContain("- 抜書き1");
    expect(md).toContain("### この文書から導いた知見・洞察（1件）");
    expect(md).toContain("**洞察A**: AはBである");
    // 派生知識があり余剰予算が大きいので原文も載る
    expect(md).toContain("### 原文");
  });

  it("派生知識が無ければ原文を予算いっぱいまで載せる", () => {
    const full = "x".repeat(100);
    const md = formatCitedDocument(
      { title: "T", mediumLabel: "PDF", memos: [], knowledge: [], fullText: full },
      80,
    );
    expect(md).toContain("### 原文（抜粋）");
    expect(md).toContain("…（以下省略）");
  });

  it("派生知識で予算を使い切ったら原文フィラーを足さない", () => {
    const md = formatCitedDocument(
      {
        title: "T",
        mediumLabel: "PDF",
        memos: [],
        knowledge: [{ title: "K", text: "y".repeat(200) }],
        fullText: "原文",
      },
      120,
    );
    expect(md).not.toContain("### 原文");
  });
});

describe("assembleCitedDocumentContext", () => {
  beforeEach(() => __clearPdfTextCacheForTest());

  it("文書ノートでなければ null", async () => {
    const got = await assembleCitedDocumentContext("n", makeDoc({}), {
      noteIndex: null,
      captureIndex: null,
      provider: { loadFile: async () => makeDoc({}), getMediaBlobUrl: async () => "" },
    });
    expect(got).toBeNull();
  });

  it("PDF ノートで派生メモと全文を組み立てる", async () => {
    const doc = makeDoc({ title: "論文X", sourcePdfFileId: "pdf-1", source: "human" });
    const captureIndex: CaptureIndex = {
      version: 1,
      updatedAt: "now",
      captures: [
        { id: "m1", text: "重要な抜書き", createdAt: "t", sourceAsset: { fileId: "pdf-1", type: "pdf" } },
      ],
    };
    const md = await assembleCitedDocumentContext("note-1", doc, {
      noteIndex: { notes: [] } as unknown as GraphiumIndex,
      captureIndex,
      provider: {
        loadFile: async () => doc,
        getMediaBlobUrl: async () => "blob:pdf",
        loadWikiFile: async () => makeDoc({}),
      },
      loadBlob: async () => new Blob(),
      extractPdfText: async () => ({ text: "PDF の全文テキスト" }),
    });
    expect(md).toContain("## 引用文書: 論文X（PDF）");
    expect(md).toContain("- 重要な抜書き");
    expect(md).toContain("PDF の全文テキスト");
  });

  it("URL ノートは本文をフォールバックに使う", async () => {
    const doc = makeDoc({
      title: "記事",
      sourceUrl: "https://example.com",
      pages: [makePage([{ type: "paragraph", content: [{ text: "記事本文" }] }], "t")],
    });
    const md = await assembleCitedDocumentContext("note-2", doc, {
      noteIndex: { notes: [] } as unknown as GraphiumIndex,
      captureIndex: null,
      provider: { loadFile: async () => doc, getMediaBlobUrl: async () => "" },
    });
    expect(md).toContain("## 引用文書: 記事（URL）");
    expect(md).toContain("記事本文");
  });
});

describe("assembleCitedAssetContext", () => {
  beforeEach(() => __clearPdfTextCacheForTest());

  it("PDF 素材の派生メモと全文を組み立てる", async () => {
    const captureIndex: CaptureIndex = {
      version: 1,
      updatedAt: "now",
      captures: [
        { id: "m1", text: "重要箇所", createdAt: "t", sourceAsset: { fileId: "pdf-9", type: "pdf" } },
        { id: "m2", text: "別素材", createdAt: "t", sourceAsset: { fileId: "pdf-x", type: "pdf" } },
      ],
    };
    const md = await assembleCitedAssetContext(
      { fileId: "pdf-9", name: "Paper.pdf", type: "pdf" },
      {
        captureIndex,
        provider: { getMediaBlobUrl: async () => "blob:x" },
        loadBlob: async () => new Blob(),
        extractPdfText: async () => ({ text: "素材の全文テキスト" }),
      },
    );
    expect(md).toContain("## 引用文書: Paper.pdf（PDF）");
    expect(md).toContain("- 重要箇所");
    expect(md).not.toContain("別素材");
    expect(md).toContain("素材の全文テキスト");
  });

  it("メモも全文も無ければ null", async () => {
    const md = await assembleCitedAssetContext(
      { fileId: "doc-1", name: "x.docx", type: "document" },
      { captureIndex: null, provider: { getMediaBlobUrl: async () => "" } },
    );
    expect(md).toBeNull();
  });
});
