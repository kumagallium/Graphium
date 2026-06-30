// buildIndexEntry / updateIndexEntry / removeIndexEntry のユニットテスト

import { describe, it, expect } from "vitest";
import {
  buildIndexEntry,
  updateIndexEntry,
  removeIndexEntry,
  ensureIndex,
  INDEX_SCHEMA_VERSION,
  type GraphiumIndex,
  type NoteIndexEntry,
} from "./index-file";
import type { GraphiumDocument, GraphiumFile } from "../../lib/document-types";
import { registerProvider, setActiveProvider } from "../../lib/storage/registry";
import type { StorageProvider } from "../../lib/storage/types";

// テスト用のモック GraphiumDocument を構築するヘルパー
function mockDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 2,
    title: "テストノート",
    pages: [
      {
        id: "page-1",
        title: "Main",
        blocks: [
          {
            id: "b1",
            type: "heading",
            props: { level: 2 },
            content: [{ type: "text", text: "背景" }],
          },
          {
            id: "b2",
            type: "paragraph",
            content: [{ type: "text", text: "段落内容" }],
          },
          {
            id: "b3",
            type: "heading",
            props: { level: 3 },
            content: [{ type: "text", text: "サブセクション" }],
          },
        ],
        labels: { b2: "entity:sample" },
        provLinks: [
          { targetNoteId: "note-A", targetBlockId: "bA1" },
        ],
        knowledgeLinks: [
          { targetNoteId: "note-B" },
        ],
        indexTables: {
          "table-1": { "Sample-001": "note-C", "Sample-002": "note-D" },
        },
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    modifiedAt: "2026-03-31T00:00:00Z",
    ...overrides,
  };
}

function mockFile(id = "file-1"): GraphiumFile {
  return {
    id,
    name: "テストノート.graphium.json",
    modifiedTime: "2026-03-31T12:00:00Z",
    createdTime: "2026-01-01T00:00:00Z",
  };
}

function mockIndex(notes: NoteIndexEntry[] = []): GraphiumIndex {
  return {
    version: 1,
    updatedAt: "2026-03-30T00:00:00Z",
    notes,
  };
}

describe("buildIndexEntry", () => {
  it("見出し（level 2, 3）を抽出する", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    expect(entry.headings).toHaveLength(2);
    expect(entry.headings[0]).toEqual({
      blockId: "b1",
      text: "背景",
      level: 2,
    });
    expect(entry.headings[1]).toEqual({
      blockId: "b3",
      text: "サブセクション",
      level: 3,
    });
  });

  it("level 1 の見出しは含めない", () => {
    const doc = mockDoc({
      pages: [
        {
          id: "page-1",
          title: "Main",
          blocks: [
            {
              id: "h1",
              type: "heading",
              props: { level: 1 },
              content: [{ type: "text", text: "タイトル" }],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.headings).toHaveLength(0);
  });

  it("ラベルを抽出する", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    expect(entry.labels).toHaveLength(1);
    expect(entry.labels[0]).toEqual({
      blockId: "b2",
      label: "entity:sample",
      preview: "段落内容",
    });
  });

  it("provLinks からの出力リンクを抽出する", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    const provLinks = entry.outgoingLinks.filter((l) => l.layer === "prov" && l.targetNoteId === "note-A");
    expect(provLinks).toHaveLength(1);
    expect(provLinks[0].targetBlockId).toBe("bA1");
  });

  it("knowledgeLinks からの出力リンクを抽出する", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    const kLinks = entry.outgoingLinks.filter((l) => l.layer === "knowledge" && l.targetNoteId === "note-B");
    expect(kLinks).toHaveLength(1);
  });

  it("indexTables からの出力リンクを抽出する", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    const tableLinks = entry.outgoingLinks.filter(
      (l) => l.targetNoteId === "note-C" || l.targetNoteId === "note-D",
    );
    expect(tableLinks).toHaveLength(2);
    expect(tableLinks.every((l) => l.layer === "knowledge")).toBe(true);
  });

  it("derivedFromNoteId を prov リンクとして含める", () => {
    const doc = mockDoc({ derivedFromNoteId: "note-parent" });
    const entry = buildIndexEntry("file-1", doc);
    const derived = entry.outgoingLinks.filter(
      (l) => l.targetNoteId === "note-parent" && l.layer === "prov",
    );
    expect(derived).toHaveLength(1);
  });

  it("noteLinks を prov リンクとして含める", () => {
    const doc = mockDoc({
      noteLinks: [
        { targetNoteId: "note-linked", sourceBlockId: "b1", type: "derived_from" },
      ],
    });
    const entry = buildIndexEntry("file-1", doc);
    const noteLinks = entry.outgoingLinks.filter(
      (l) => l.targetNoteId === "note-linked" && l.layer === "prov",
    );
    expect(noteLinks).toHaveLength(1);
    expect(noteLinks[0].targetBlockId).toBe("b1");
  });

  it("file が指定されればその日時を使用する", () => {
    const file = mockFile("file-1");
    const entry = buildIndexEntry("file-1", mockDoc(), file);
    expect(entry.modifiedAt).toBe(file.modifiedTime);
    expect(entry.createdAt).toBe(file.createdTime);
  });

  it("file が未指定なら doc の日時を使用する", () => {
    const doc = mockDoc();
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.modifiedAt).toBe(doc.modifiedAt);
    expect(entry.createdAt).toBe(doc.createdAt);
  });

  it("noteId と title を正しく設定する", () => {
    const entry = buildIndexEntry("my-note-id", mockDoc());
    expect(entry.noteId).toBe("my-note-id");
    expect(entry.title).toBe("テストノート");
  });

  it("pages が空の場合も安全に動作する", () => {
    const doc = mockDoc({ pages: [] });
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.headings).toHaveLength(0);
    expect(entry.labels).toHaveLength(0);
    expect(entry.outgoingLinks).toHaveLength(0);
  });

  // Phase D-3-α: インラインハイライト + メディアインラインラベルの集計
  it("inline style ハイライトを (blockId, label, text, entityId) の単位でエントリ化する", () => {
    const doc = mockDoc({
      pages: [
        {
          id: "page-1",
          title: "Main",
          blocks: [
            {
              id: "p1",
              type: "paragraph",
              content: [
                { type: "text", text: "NaCl", styles: { inlineMaterial: "ent_nacl" } },
                { type: "text", text: " を使う", styles: {} },
                { type: "text", text: "ピペット", styles: { inlineTool: "ent_pip" } },
              ],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.inlineLabels).toBeDefined();
    expect(entry.inlineLabels).toEqual(
      expect.arrayContaining([
        { blockId: "p1", label: "material", text: "NaCl", entityId: "ent_nacl" },
        { blockId: "p1", label: "tool", text: "ピペット", entityId: "ent_pip" },
      ]),
    );
  });

  it("同 (label, entityId) の連続ハイライトはブロック内で text を連結する", () => {
    const doc = mockDoc({
      pages: [
        {
          id: "page-1",
          title: "Main",
          blocks: [
            {
              id: "p1",
              type: "paragraph",
              content: [
                { type: "text", text: "Na", styles: { inlineMaterial: "ent_x" } },
                { type: "text", text: "Cl", styles: { inlineMaterial: "ent_x" } },
              ],
            },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
        },
      ],
    });
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.inlineLabels).toEqual([
      { blockId: "p1", label: "material", text: "NaCl", entityId: "ent_x" },
    ]);
  });

  it("mediaInlineLabels (Phase D-3-β サイドストア) も inlineLabels にエントリ化する", () => {
    const doc = mockDoc({
      pages: [
        {
          id: "page-1",
          title: "Main",
          blocks: [
            { id: "img-1", type: "image", props: { url: "x.png", name: "diagram.png" }, content: undefined },
          ],
          labels: {},
          provLinks: [],
          knowledgeLinks: [],
          mediaInlineLabels: {
            "img-1": { label: "output", entityId: "ent_x" },
          },
        },
      ],
    });
    const entry = buildIndexEntry("file-1", doc);
    expect(entry.inlineLabels).toContainEqual({
      blockId: "img-1",
      label: "output",
      text: "diagram.png",
      entityId: "ent_x",
    });
  });

  it("インラインラベルがゼロなら inlineLabels は undefined のまま", () => {
    const entry = buildIndexEntry("file-1", mockDoc());
    expect(entry.inlineLabels).toBeUndefined();
  });
});

describe("updateIndexEntry", () => {
  it("既存エントリを置換する", () => {
    const existingEntry: NoteIndexEntry = {
      noteId: "file-1",
      title: "古いタイトル",
      modifiedAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
    };
    const index = mockIndex([existingEntry]);
    const doc = mockDoc({ title: "新しいタイトル" });

    const updated = updateIndexEntry(index, "file-1", doc);
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].title).toBe("新しいタイトル");
  });

  it("存在しないエントリは新規追加される", () => {
    const existingEntry: NoteIndexEntry = {
      noteId: "file-existing",
      title: "既存ノート",
      modifiedAt: "2026-01-01T00:00:00Z",
      createdAt: "2026-01-01T00:00:00Z",
      headings: [],
      labels: [],
      outgoingLinks: [],
    };
    const index = mockIndex([existingEntry]);
    const doc = mockDoc({ title: "新規ノート" });

    const updated = updateIndexEntry(index, "file-new", doc);
    expect(updated.notes).toHaveLength(2);
    expect(updated.notes.find((n) => n.noteId === "file-new")?.title).toBe("新規ノート");
    expect(updated.notes.find((n) => n.noteId === "file-existing")?.title).toBe("既存ノート");
  });

  it("updatedAt を更新する", () => {
    const index = mockIndex([]);
    const doc = mockDoc();
    const updated = updateIndexEntry(index, "file-1", doc);
    // updatedAt は mockIndex の値よりも新しいはず
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(index.updatedAt).getTime(),
    );
  });
});

describe("removeIndexEntry", () => {
  it("noteId に一致するエントリを除去する", () => {
    const entries: NoteIndexEntry[] = [
      {
        noteId: "file-1",
        title: "ノート1",
        modifiedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        headings: [],
        labels: [],
        outgoingLinks: [],
      },
      {
        noteId: "file-2",
        title: "ノート2",
        modifiedAt: "2026-02-01T00:00:00Z",
        createdAt: "2026-02-01T00:00:00Z",
        headings: [],
        labels: [],
        outgoingLinks: [],
      },
    ];
    const index = mockIndex(entries);

    const updated = removeIndexEntry(index, "file-1");
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].noteId).toBe("file-2");
  });

  it("存在しない noteId を指定しても他のエントリに影響しない", () => {
    const entries: NoteIndexEntry[] = [
      {
        noteId: "file-1",
        title: "ノート1",
        modifiedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        headings: [],
        labels: [],
        outgoingLinks: [],
      },
    ];
    const index = mockIndex(entries);

    const updated = removeIndexEntry(index, "non-existent");
    expect(updated.notes).toHaveLength(1);
    expect(updated.notes[0].noteId).toBe("file-1");
  });

  it("updatedAt を更新する", () => {
    const index = mockIndex([]);
    const updated = removeIndexEntry(index, "any-id");
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(
      new Date(index.updatedAt).getTime(),
    );
  });

  it("元のインデックスを変更しない（イミュータブル）", () => {
    const entries: NoteIndexEntry[] = [
      {
        noteId: "file-1",
        title: "ノート1",
        modifiedAt: "2026-01-01T00:00:00Z",
        createdAt: "2026-01-01T00:00:00Z",
        headings: [],
        labels: [],
        outgoingLinks: [],
      },
    ];
    const index = mockIndex(entries);
    const originalNotes = [...index.notes];

    removeIndexEntry(index, "file-1");
    // 元の index.notes は変更されていないこと
    expect(index.notes).toEqual(originalNotes);
  });
});

describe("ensureIndex の archivedAt / deletedAt 保持", () => {
  // ensureIndex は保存時に writeAppData を呼ぶだけなので、ノーオペのモックで足りる。
  // loadFile は docCache を事前投入しておけば呼ばれない。
  const mockProvider = {
    id: "test-mem",
    writeAppData: async () => {},
    readAppData: async () => null,
    loadFile: async () => {
      throw new Error("loadFile should not be called when docCache is pre-populated");
    },
  } as unknown as StorageProvider;
  registerProvider(mockProvider);
  setActiveProvider("test-mem");

  // ノートが「stale」になる（ファイルの modifiedTime > index の modifiedAt + 1s）と、
  // ensureIndex は buildIndexEntry で作り直す。archivedAt / deletedAt は doc に乗らず
  // index にしか無いため、引き継がないと作り直しで落ちてしまう（=一覧へ復活する）。
  it("差分更新（stale）でアーカイブ済みノートの archivedAt を保持する", async () => {
    const archivedEntry: NoteIndexEntry = {
      ...buildIndexEntry("file-1", mockDoc()),
      modifiedAt: "2026-03-31T00:00:00Z", // ファイルより古い → stale
      archivedAt: "2026-04-01T00:00:00Z",
    };
    const existing: GraphiumIndex = {
      version: INDEX_SCHEMA_VERSION,
      updatedAt: "2026-03-31T00:00:00Z",
      notes: [archivedEntry],
    };
    // mockFile の modifiedTime は 2026-03-31T12:00:00Z で entry より新しい → stale 判定
    const docCache = new Map<string, GraphiumDocument>([["file-1", mockDoc()]]);

    const result = await ensureIndex([mockFile("file-1")], docCache, existing);
    const entry = result.notes.find((n) => n.noteId === "file-1");
    expect(entry?.archivedAt).toBe("2026-04-01T00:00:00Z");
  });

  it("差分更新（stale）でゴミ箱のノートの deletedAt を保持する", async () => {
    const trashedEntry: NoteIndexEntry = {
      ...buildIndexEntry("file-1", mockDoc()),
      modifiedAt: "2026-03-31T00:00:00Z",
      deletedAt: "2026-04-01T00:00:00Z",
    };
    const existing: GraphiumIndex = {
      version: INDEX_SCHEMA_VERSION,
      updatedAt: "2026-03-31T00:00:00Z",
      notes: [trashedEntry],
    };
    const docCache = new Map<string, GraphiumDocument>([["file-1", mockDoc()]]);

    const result = await ensureIndex([mockFile("file-1")], docCache, existing);
    const entry = result.notes.find((n) => n.noteId === "file-1");
    expect(entry?.deletedAt).toBe("2026-04-01T00:00:00Z");
  });

  // schema bump 時の全件再構築でもフラグを失わないこと。
  it("全件再構築（version 不一致）でも archivedAt を保持する", async () => {
    const archivedEntry: NoteIndexEntry = {
      ...buildIndexEntry("file-1", mockDoc()),
      modifiedAt: "2026-03-31T00:00:00Z",
      archivedAt: "2026-04-01T00:00:00Z",
    };
    const existing: GraphiumIndex = {
      version: INDEX_SCHEMA_VERSION - 1, // 古い → full rebuild
      updatedAt: "2026-03-31T00:00:00Z",
      notes: [archivedEntry],
    };
    const docCache = new Map<string, GraphiumDocument>([["file-1", mockDoc()]]);

    const result = await ensureIndex([mockFile("file-1")], docCache, existing);
    const entry = result.notes.find((n) => n.noteId === "file-1");
    expect(entry?.archivedAt).toBe("2026-04-01T00:00:00Z");
  });
});
