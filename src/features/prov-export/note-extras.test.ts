// 付属情報の収集（collectNoteProvExtras）のテスト

import { describe, it, expect } from "vitest";
import { collectNoteProvExtras } from "./note-extras";
import { buildNoteProvJsonLd } from "./note-export";
import { generateProvDocument } from "../prov-generator/generator";
import type { GraphiumDocument } from "../../lib/document-types";
import type { CaptureEntry, CaptureIndex } from "../mobile-capture/capture-store";
import type { MediaIndexEntry } from "../asset-browser/media-index";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";
import type { BlockLink } from "../block-link/link-types";

const NOTE_ID = "note-1";

function makeDoc(over?: Partial<GraphiumDocument> & { page?: Record<string, any> }): GraphiumDocument {
  const { page, ...rest } = over ?? {};
  return {
    version: 6,
    title: "ノート",
    pages: [
      {
        id: "p1",
        title: "Main",
        blocks: [],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
        ...page,
      },
    ],
    createdAt: "2026-10-01T00:00:00.000Z",
    modifiedAt: "2026-10-29T00:00:00.000Z",
    ...rest,
  } as GraphiumDocument;
}

function media(over: Partial<MediaIndexEntry> & { fileId: string }): MediaIndexEntry {
  return {
    name: over.fileId,
    type: "pdf",
    mimeType: "application/pdf",
    url: "",
    thumbnailUrl: "",
    uploadedAt: "2026-09-01T00:00:00.000Z",
    usedIn: [],
    ...over,
  } as MediaIndexEntry;
}

function capture(over: Partial<CaptureEntry> & { id: string }): CaptureEntry {
  return { text: "メモ", createdAt: "2026-10-01T00:00:00.000Z", ...over };
}
const captureIndex = (captures: CaptureEntry[]): CaptureIndex => ({
  version: 1,
  updatedAt: "2026-10-29T00:00:00.000Z",
  captures,
});

describe("collectNoteProvExtras — doc から取る項目", () => {
  it("何も無い doc では modifiedAt と resolveFileId だけになる（値の無いキーは作らない）", () => {
    const extras = collectNoteProvExtras({ doc: makeDoc(), noteId: NOTE_ID });
    expect(Object.keys(extras).sort()).toEqual(["modifiedAt", "resolveFileId"]);
    expect(extras.modifiedAt).toBe("2026-10-29T00:00:00.000Z");
  });

  it("folders / sources / influences / partOfPlanNoteId / tableMeta / chats を拾う", () => {
    const doc = makeDoc({
      noteContexts: ["計画/工程", "材料X"],
      sourceUrl: "https://example.com/p",
      sourceTitle: "Example",
      sourcePdfFileId: "pdf-1",
      sourcePdfName: "paper.pdf",
      sourceDocumentFileId: "doc-1",
      sourceTextFileId: "txt-1",
      derivedFromNoteId: "note-parent",
      templateFrom: { userTemplateId: "ut-1", title: "テンプレ", usedAt: "2026-10-01T00:00:00Z" },
      forkedFrom: { sharedId: "sh-1", hash: "h", authorName: "A", authorEmail: "a@example.com", forkedAt: "2026-10-01T00:00:00Z" },
      importSource: { path: "data/a.txt", contentHash: "sha256:aa", importedAt: "2026-10-01T00:00:00Z" },
      citedAssetFileIds: ["img-1"],
      partOfPlanNoteId: "plan-1",
      noteLinks: [{ targetNoteId: "child-1", sourceBlockId: "b1", type: "derived_from" }],
      chats: [
        {
          id: "c1",
          scopeBlockId: "b1",
          scopeType: "block",
          generatedBy: { agent: "chat", sessionId: "s", model: "claude-x" },
          messages: [
            { role: "user", content: "q", timestamp: "2026-10-02T00:00:00Z" },
            { role: "assistant", content: "a", timestamp: "2026-10-02T00:00:01Z" },
          ],
          createdAt: "2026-10-02T00:00:00Z",
          modifiedAt: "2026-10-02T00:00:01Z",
        },
        { id: "empty", scopeBlockId: "b2", scopeType: "block", messages: [], createdAt: "x", modifiedAt: "x" },
      ],
      page: {
        knowledgeLinks: [
          { id: "k1", sourceBlockId: "b1", targetBlockId: "x", type: "reference", layer: "knowledge", createdBy: "human", targetNoteId: "wiki-1", targetNoteTitle: "知見" },
          { id: "k2", sourceBlockId: "b2", targetBlockId: "x", type: "reference", layer: "knowledge", createdBy: "human", targetNoteId: "wiki-1" },
          { id: "k3", sourceBlockId: "b2", targetBlockId: "x", type: "reference", layer: "knowledge", createdBy: "human", targetNoteId: NOTE_ID },
        ],
        tableMeta: {
          t1: { caption: " 表 " },
          t2: { columns: { a: ["note-link"] } },
          t3: { source: { kind: "delimited-file", fileName: "f.csv", importedAt: "x", options: {} } },
        },
      },
    } as any);
    const extras = collectNoteProvExtras({
      doc,
      noteId: NOTE_ID,
      mediaIndex: [media({ fileId: "img-1", type: "image", name: "fig.png" })],
    });

    expect(extras.folders).toEqual(["計画/工程", "材料X"]);
    expect(extras.sources).toEqual([
      { kind: "url", id: "https://example.com/p", label: "Example" },
      { kind: "pdf", id: "pdf-1", label: "paper.pdf" },
      { kind: "document", id: "doc-1" },
      { kind: "text", id: "txt-1" },
      { kind: "note", id: "note-parent" },
      { kind: "template", id: "ut-1", label: "テンプレ" },
      { kind: "shared", id: "sh-1" },
      { kind: "import", id: "sha256:aa", label: "data/a.txt" },
    ]);
    // noteLinks（子ノートへの参照）は派生元に入れない
    expect(extras.sources!.some((s) => s.id === "child-1")).toBe(false);
    expect(extras.influences).toEqual([
      { kind: "asset", id: "img-1", type: "image", label: "fig.png" },
      { kind: "wiki", id: "wiki-1", label: "知見" },
    ]);
    expect(extras.partOfPlanNoteId).toBe("plan-1");
    expect(Object.keys(extras.tableMeta!).sort()).toEqual(["t1", "t3"]);
    expect(extras.tableMeta!.t1).toEqual({ caption: "表" });
    expect(extras.chats).toEqual([
      {
        id: "c1",
        scopeBlockId: "b1",
        scopeType: "block",
        model: "claude-x",
        messages: [
          { role: "user", content: "q", timestamp: "2026-10-02T00:00:00Z" },
          { role: "assistant", content: "a", timestamp: "2026-10-02T00:00:01Z" },
        ],
      },
    ]);
  });

  it("wikiEntities から知見リンクの表示名を補う", () => {
    const doc = makeDoc({
      page: {
        knowledgeLinks: [
          { id: "k1", sourceBlockId: "b1", targetBlockId: "x", type: "reference", layer: "knowledge", createdBy: "human", targetNoteId: "wiki-1" },
        ],
      },
    });
    const extras = collectNoteProvExtras({
      doc,
      noteId: NOTE_ID,
      wikiEntities: [{ id: "wiki-1", title: "Annealing", kind: "claim", status: "x", generatedAt: "x", model: "m", derivedFromNotes: [] }],
    });
    expect(extras.influences).toEqual([{ kind: "wiki", id: "wiki-1", label: "Annealing" }]);
  });

  it("identity は humanAgent に（空なら作らない）", () => {
    expect(collectNoteProvExtras({ doc: makeDoc(), noteId: NOTE_ID, identity: { name: "山田", email: "y@example.com" } }).humanAgent).toEqual({
      name: "山田",
      email: "y@example.com",
    });
    expect(collectNoteProvExtras({ doc: makeDoc(), noteId: NOTE_ID, identity: {} }).humanAgent).toBeUndefined();
  });

  it("既定の resolveFileId は 3 スキームから fileId を取り出す", () => {
    const { resolveFileId } = collectNoteProvExtras({ doc: makeDoc(), noteId: NOTE_ID });
    expect(resolveFileId!("media-server://abc123")).toBe("abc123");
    expect(resolveFileId!("file-media://abc123?x=1")).toBe("abc123");
    expect(resolveFileId!("local-media://a%20b")).toBe("a b");
    expect(resolveFileId!("https://example.com/x.png")).toBeNull();
  });
});

describe("collectNoteProvExtras — メモと素材", () => {
  it("archived / deleted を除き、このノート・参照素材・挿入済みのメモだけ拾う", () => {
    const doc = makeDoc({ citedAssetFileIds: ["pdf-1"] });
    const extras = collectNoteProvExtras({
      doc,
      noteId: NOTE_ID,
      mediaIndex: new Map([
        ["pdf-1", media({ fileId: "pdf-1", name: "paper.pdf" })],
        ["pdf-2", media({ fileId: "pdf-2" })],
      ]),
      captureIndex: captureIndex([
        capture({ id: "own", sourceNote: { fileId: NOTE_ID, blockId: "b1", blockText: "t" } }),
        capture({ id: "asset", sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 2 } }),
        capture({ id: "other-asset", sourceAsset: { fileId: "pdf-2", type: "pdf" } }),
        capture({ id: "used", usedIn: [{ noteId: NOTE_ID, noteTitle: "n", insertedAt: "2026-10-02T00:00:00Z" }] }),
        capture({ id: "stray", sourceNote: { fileId: "note-other" } }),
        capture({ id: "archived", sourceNote: { fileId: NOTE_ID }, archivedAt: "2026-10-03T00:00:00Z" }),
        capture({ id: "deleted", sourceNote: { fileId: NOTE_ID }, deletedAt: "2026-10-03T00:00:00Z" }),
      ]),
    });
    expect(extras.memos!.map((m) => m.id)).toEqual(["own", "asset", "used"]);
    expect(extras.memos![0]).toMatchObject({
      sourceNote: { fileId: NOTE_ID, blockId: "b1", blockText: "t" },
      usedInThisNote: false,
      edited: false,
      isQuote: false,
    });
    expect(extras.memos![1].sourceAsset).toEqual({ fileId: "pdf-1", type: "pdf", pageNumber: 2 });
    expect(extras.memos![2].usedInThisNote).toBe(true);
  });

  it("isQuote は sourceAsset と出典行（\\n\\n— ）の両方がそろったときだけ。edited は editHistory から", () => {
    const extras = collectNoteProvExtras({
      doc: makeDoc({ citedAssetFileIds: ["pdf-1"] }),
      noteId: NOTE_ID,
      mediaIndex: [media({ fileId: "pdf-1" })],
      captureIndex: captureIndex([
        capture({ id: "q", text: "引用\n\n— paper.pdf", sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
        capture({
          id: "e",
          text: "直した",
          modifiedAt: "2026-10-05T00:00:00Z",
          editHistory: [{ editedAt: "2026-10-05T00:00:00Z", previousText: "前" }],
          sourceAsset: { fileId: "pdf-1", type: "pdf" },
        }),
        capture({ id: "noasset", text: "x\n\n— y", sourceNote: { fileId: NOTE_ID } }),
      ]),
    });
    const byId = Object.fromEntries(extras.memos!.map((m) => [m.id, m]));
    expect(byId.q.isQuote).toBe(true);
    expect(byId.e.isQuote).toBe(false);
    expect(byId.e.edited).toBe(true);
    expect(byId.e.modifiedAt).toBe("2026-10-05T00:00:00Z");
    expect(byId.noasset.isQuote).toBe(false);
  });

  it("memoQuotes に載っているメモは、usedIn が無くても「このノートに挿入されたメモ」として拾う（本文にブロックがあるものだけ）", () => {
    const quote = (captureId: string) => ({ captureId, quotedAt: "2026-10-30T00:00:00Z", quotedText: "メモ" });
    const extras = collectNoteProvExtras({
      doc: makeDoc({
        page: {
          // b-nested は子ブロック。b-gone は本文に無い（消したブロックに紐づけだけが残った）
          blocks: [
            { id: "b1", type: "quote" },
            { id: "b0", type: "paragraph", children: [{ id: "b-nested", type: "quote" }] },
            // 段落に変えたブロック（紐づけだけが残った）
            { id: "b-changed", type: "paragraph" },
          ],
          memoQuotes: {
            b1: quote("quoted"),
            "b-nested": quote("nested"),
            "b-gone": quote("gone"),
            "b-changed": quote("changed"),
          },
        },
      }),
      noteId: NOTE_ID,
      captureIndex: captureIndex([
        capture({ id: "quoted" }),
        capture({ id: "nested" }),
        capture({ id: "gone" }),
        capture({ id: "changed" }),
        capture({ id: "trashed", deletedAt: "2026-10-03T00:00:00Z" }),
      ]),
    });
    expect(extras.memos!.map((m) => m.id)).toEqual(["quoted", "nested"]);
    expect(extras.memos!.every((m) => m.usedInThisNote)).toBe(true);
  });

  it("assets は参照されるものだけ（引用・出典・usedIn・書き出すメモの素材）で、索引にあるものに限る", () => {
    const extras = collectNoteProvExtras({
      doc: makeDoc({ citedAssetFileIds: ["a1"], sourcePdfFileId: "a2", sourceTextFileId: "not-in-index" }),
      noteId: NOTE_ID,
      mediaIndex: [
        media({
          fileId: "a1",
          type: "image",
          name: "fig.png",
          mimeType: "image/png",
          sourceInfo: { authors: ["A"], year: 2020, doi: "10.1/x" },
        }),
        media({ fileId: "a2" }),
        media({ fileId: "a3", usedIn: [{ noteId: NOTE_ID, noteTitle: "n", blockId: "b" }] }),
        media({ fileId: "a4", usedIn: [{ noteId: "note-other", noteTitle: "o", blockId: "b" }] }),
        media({ fileId: "a5" }),
      ],
      captureIndex: captureIndex([
        capture({ id: "m", sourceNote: { fileId: NOTE_ID }, sourceAsset: { fileId: "a5", type: "pdf" } }),
      ]),
    });
    expect(extras.assets!.map((a) => a.fileId).sort()).toEqual(["a1", "a2", "a3", "a5"]);
    const a1 = extras.assets!.find((a) => a.fileId === "a1")!;
    expect(a1).toEqual({
      fileId: "a1",
      type: "image",
      name: "fig.png",
      mimeType: "image/png",
      sourceInfo: { authors: ["A"], year: 2020, doi: "10.1/x" },
    });
  });

  it("captureIndex / mediaIndex が無ければ memos / assets は作らない", () => {
    const extras = collectNoteProvExtras({ doc: makeDoc({ citedAssetFileIds: ["a1"] }), noteId: NOTE_ID });
    expect(extras.memos).toBeUndefined();
    expect(extras.assets).toBeUndefined();
  });
});

describe("collectNoteProvExtras — 計画の線の名前", () => {
  const cell = (text: string) => [{ type: "text", text, styles: {} }];
  const planDoc = (): GraphiumDocument =>
    makeDoc({
      noteContexts: ["計画"],
      page: {
        blocks: [
          {
            id: "t1",
            type: "table",
            content: {
              type: "tableContent",
              rows: [
                { cells: ["工程", "入力元"].map(cell) },
                { cells: ["@合成", ""].map(cell) },
                { cells: ["@焼成", "合成"].map(cell) },
              ],
            },
          },
        ],
        tableMeta: {
          t1: {
            noteLinks: { "@合成": "note-a", "@焼成": "note-b" },
            columns: { 工程: ["note-link"], 入力元: ["planned-input"] },
            edgeLabels: { 焼成: { 合成: "反応生成物" } },
          },
        },
      },
    });
  const entry = (noteId: string, over?: Partial<NoteIndexEntry>): NoteIndexEntry =>
    ({
      noteId,
      title: noteId,
      modifiedAt: "2026-10-01T00:00:00.000Z",
      createdAt: "2026-10-01T00:00:00.000Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
      ...over,
    }) as NoteIndexEntry;
  const index = (): GraphiumIndex => ({
    version: 32,
    updatedAt: "2026-10-01T00:00:00.000Z",
    notes: [
      entry("plan-1", {
        noteContexts: ["計画"],
        outgoingLinks: [
          { targetNoteId: "note-a", layer: "knowledge" },
          { targetNoteId: "note-b", layer: "knowledge" },
        ],
      }),
      entry("note-a"),
      entry("note-b"),
    ],
  });
  const link = (targetNoteId: string): BlockLink => ({
    id: "l1",
    sourceBlockId: "b",
    targetBlockId: "t",
    type: "informed_by",
    layer: "prov",
    createdBy: "human",
    targetNoteId,
    targetEntityId: "e1",
  });

  it("計画の表の inputLabels から、供給側の行名で引く", () => {
    const extras = collectNoteProvExtras({
      doc: makeDoc(),
      noteId: "note-b",
      planContext: { index: index(), planDocs: new Map([["plan-1", planDoc()]]) },
    });
    expect(extras.edgeLabelForLink).toBeTypeOf("function");
    expect(extras.edgeLabelForLink!(link("note-a"))).toBe("反応生成物");
    // 計画に無い供給元・名前の無い組は undefined
    expect(extras.edgeLabelForLink!(link("note-zzz"))).toBeUndefined();
  });

  it("計画が見つからない・planContext が無いときは edgeLabelForLink を作らない", () => {
    expect(collectNoteProvExtras({ doc: makeDoc(), noteId: "note-b" }).edgeLabelForLink).toBeUndefined();
    expect(
      collectNoteProvExtras({ doc: makeDoc(), noteId: "note-unrelated", planContext: { index: index(), planDocs: new Map() } })
        .edgeLabelForLink,
    ).toBeUndefined();
    // 計画の doc が渡されていなければ名前は引けない
    const extras = collectNoteProvExtras({
      doc: makeDoc(),
      noteId: "note-b",
      planContext: { index: index(), planDocs: new Map() },
    });
    expect(extras.edgeLabelForLink!(link("note-a"))).toBeUndefined();
  });
});

describe("collectNoteProvExtras → buildNoteProvJsonLd（結合）", () => {
  it("集めた extras をそのまま渡して書き出せる", () => {
    const doc = makeDoc({
      noteContexts: ["材料X"],
      sourceUrl: "https://example.com/p",
      citedAssetFileIds: ["pdf-1"],
      page: {
        blocks: [
          { id: "h1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "焼成", styles: {} }], children: [] },
        ],
        labels: { h1: "procedure" },
      },
    });
    const extras = collectNoteProvExtras({
      doc,
      noteId: NOTE_ID,
      mediaIndex: [media({ fileId: "pdf-1", name: "paper.pdf" })],
      captureIndex: captureIndex([
        capture({ id: "m1", text: "引用\n\n— paper.pdf", createdBy: "y@example.com", sourceAsset: { fileId: "pdf-1", type: "pdf", pageNumber: 1 } }),
      ]),
      identity: { name: "山田", email: "y@example.com" },
    });
    const page = doc.pages[0];
    const provDoc = generateProvDocument({ blocks: page.blocks, labels: new Map(Object.entries(page.labels)), links: [] });
    const out = buildNoteProvJsonLd({ provDoc, title: doc.title, noteId: NOTE_ID, page, extras });
    const ids = out["@graph"].map((n) => n["@id"]);
    expect(ids).toContain("graphium:note/note-1");
    expect(ids).toContain("graphium:folder/%E6%9D%90%E6%96%99X");
    expect(ids).toContain("graphium:memo/m1");
    expect(ids).toContain("graphium:pdf/pdf-1");
    const memo = out["@graph"].find((n) => n["@id"] === "graphium:memo/m1")!;
    expect(memo["oa:motivatedBy"]).toHaveLength(2);
  });
});

describe("collectNoteProvExtras — 順序非依存と接頭辞（レビュー指摘）", () => {
  const mediaIndex = () =>
    new Map([
      ["pdf-1", media({ fileId: "pdf-1" })],
      ["pdf-2", media({ fileId: "pdf-2" })],
    ]);
  const caps = () => [
    capture({ id: "own", sourceNote: { fileId: NOTE_ID }, sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
    // 他ノートで書かれた pdf-1 のメモ。ノート自体は pdf-1 を参照していない
    capture({ id: "stray", createdBy: "x@example.com", sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
    capture({ id: "other", sourceAsset: { fileId: "pdf-2", type: "pdf" } }),
  ];

  it("captures の並びを逆にしても採否が同じ。メモ経由の素材はメモの採否に連鎖しない", () => {
    const run = (captures: CaptureEntry[]) =>
      collectNoteProvExtras({
        doc: makeDoc(),
        noteId: NOTE_ID,
        mediaIndex: mediaIndex(),
        captureIndex: captureIndex(captures),
      });
    const a = run(caps());
    const b = run(caps().reverse());
    expect(a.memos!.map((m) => m.id)).toEqual(["own"]);
    expect(b.memos!.map((m) => m.id)).toEqual(["own"]);
    // 採用メモの出典素材は assets には添える
    expect(a.assets!.map((x) => x.fileId)).toEqual(["pdf-1"]);
    expect(b.assets!.map((x) => x.fileId)).toEqual(["pdf-1"]);
  });

  it("wiki: 接頭辞付きで保存されたメモ・素材の usedIn も照合できる", () => {
    const extras = collectNoteProvExtras({
      doc: makeDoc(),
      noteId: "wiki:abc",
      mediaIndex: [
        media({
          fileId: "pdf-1",
          usedIn: [{ noteId: "abc", noteTitle: "n", blockId: "b" } as any],
        }),
      ],
      captureIndex: captureIndex([
        capture({ id: "own", sourceNote: { fileId: "wiki:abc" } }),
        capture({ id: "used", usedIn: [{ noteId: "wiki:abc", noteTitle: "n", insertedAt: "2026-10-02T00:00:00Z" }] }),
        capture({ id: "ofasset", sourceAsset: { fileId: "pdf-1", type: "pdf" } }),
        capture({ id: "stray", sourceNote: { fileId: "wiki:zzz" } }),
      ]),
    });
    expect(extras.memos!.map((m) => m.id)).toEqual(["own", "used", "ofasset"]);
    expect(extras.assets!.map((a) => a.fileId)).toEqual(["pdf-1"]);
  });
});
