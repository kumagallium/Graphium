// lineage.ts のノート間来歴追跡の回帰テスト。
// search.ts の allEntries() がプロセス内キャッシュを持つため、各テスト前に resetSearchIndex() で捨てる。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { upstreamOf, downstreamOf, traceLineage } from "./lineage";
import { resetSearchIndex } from "./search";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";
import type { BlockLink } from "../lib/block-link-types";
import type { GraphiumDocument, NoteLink } from "../lib/document-types";

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: overrides.noteId ?? "note-1",
    title: overrides.title ?? "テストノート",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...overrides,
  };
}

function makeProvLink(overrides: Partial<BlockLink> = {}): BlockLink {
  return {
    id: `link-${Math.random()}`,
    sourceBlockId: "src-block",
    targetBlockId: "",
    type: "derived_from",
    layer: "prov",
    createdBy: "human",
    ...overrides,
  };
}

function makeDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 6,
    title: "ドキュメント",
    pages: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

/** 一時 vault を組み立て、notes/ と appdata/note-index.json を書く */
function buildVault(
  dir: string,
  docs: Record<string, GraphiumDocument>,
  entries: NoteIndexEntry[],
): void {
  const notesDirPath = join(dir, "notes");
  const appdata = join(dir, "appdata");
  mkdirSync(notesDirPath, { recursive: true });
  mkdirSync(appdata, { recursive: true });
  for (const [noteId, doc] of Object.entries(docs)) {
    writeFileSync(join(notesDirPath, `${noteId}.json`), JSON.stringify(doc), "utf8");
  }
  const index: GraphiumIndex = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    notes: entries,
  };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
}

describe("lineage", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  describe("upstreamOf", () => {
    it("page.provLinks（targetNoteId 付き）と doc.derivedFromNoteId の両方を拾う", () => {
      const doc = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s1",
                targetBlockId: "t1",
                targetNoteId: "note-b",
                targetNoteTitle: "ノートB",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
        derivedFromNoteId: "note-c",
        derivedFromBlockId: "block-c",
      });

      buildVault(
        dir,
        { "note-a": doc },
        [makeEntry({ noteId: "note-a" })],
      );

      const edges = upstreamOf("note-a", dir);
      const targetIds = edges.map((e) => e.noteId).sort();
      expect(targetIds).toEqual(["note-b", "note-c"]);
    });

    it("自ノートを指すリンク（self-loop）を除外する", () => {
      const doc = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({ sourceBlockId: "s1", targetBlockId: "t1", targetNoteId: "note-a" }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(dir, { "note-a": doc }, [makeEntry({ noteId: "note-a" })]);

      expect(upstreamOf("note-a", dir)).toEqual([]);
    });
  });

  describe("downstreamOf", () => {
    it("doc.noteLinks 経由で派生先を拾う", () => {
      const noteLink: NoteLink = {
        targetNoteId: "note-y",
        sourceBlockId: "b1",
        type: "derived_from",
      };
      const docX = makeDoc({ noteLinks: [noteLink] });
      const docY = makeDoc();

      buildVault(
        dir,
        { "note-x": docX, "note-y": docY },
        [makeEntry({ noteId: "note-x" }), makeEntry({ noteId: "note-y", title: "ノートY" })],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-y");
    });

    it("相手ノートの derivedFromNoteId からの逆引きでも拾う（noteLinks が無いケース）", () => {
      const docP = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "blockA",
                targetBlockId: "",
                targetNoteId: "note-x",
                targetNoteTitle: "ノートX",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });
      const docX = makeDoc();

      buildVault(
        dir,
        { "note-p": docP, "note-x": docX },
        [
          makeEntry({
            noteId: "note-p",
            title: "ノートP",
            outgoingLinks: [{ targetNoteId: "note-x", layer: "prov" }],
          }),
          makeEntry({ noteId: "note-x", title: "ノートX" }),
        ],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-p");
    });

    it("同じ関係が noteLinks と逆引きの両方に現れても 1 件に重複排除される", () => {
      const noteLink: NoteLink = {
        targetNoteId: "note-p",
        sourceBlockId: "blockA",
        type: "derived_from",
      };
      const docX = makeDoc({ noteLinks: [noteLink] });
      const docP = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "blockA",
                targetBlockId: "",
                targetNoteId: "note-x",
                targetNoteTitle: "ノートX",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(
        dir,
        { "note-x": docX, "note-p": docP },
        [
          makeEntry({
            noteId: "note-p",
            title: "ノートP",
            outgoingLinks: [{ targetNoteId: "note-x", layer: "prov" }],
          }),
          makeEntry({ noteId: "note-x", title: "ノートX" }),
        ],
      );

      const edges = downstreamOf("note-x", dir);
      expect(edges).toHaveLength(1);
      expect(edges[0].noteId).toBe("note-p");
    });
  });

  describe("traceLineage", () => {
    it("depth が効く（2 段先まで辿る）", () => {
      // note-3 は note-2 から派生、note-2 は note-1 から派生（provLinks は上流を指す）
      const doc1 = makeDoc();
      const doc2 = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s2",
                targetBlockId: "t2",
                targetNoteId: "note-1",
                targetNoteTitle: "ノート1",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });
      const doc3 = makeDoc({
        pages: [
          {
            id: "page-1",
            title: "ページ1",
            blocks: [],
            labels: {},
            provLinks: [
              makeProvLink({
                sourceBlockId: "s3",
                targetBlockId: "t3",
                targetNoteId: "note-2",
                targetNoteTitle: "ノート2",
              }),
            ],
            knowledgeLinks: [],
          },
        ],
      });

      buildVault(
        dir,
        { "note-1": doc1, "note-2": doc2, "note-3": doc3 },
        [
          makeEntry({ noteId: "note-1", title: "ノート1" }),
          makeEntry({ noteId: "note-2", title: "ノート2" }),
          makeEntry({ noteId: "note-3", title: "ノート3" }),
        ],
      );

      const shallow = traceLineage("note-3", { direction: "upstream", depth: 1 }, dir);
      expect(shallow.upstream.map((n) => n.noteId)).toEqual(["note-2"]);

      const deep = traceLineage("note-3", { direction: "upstream", depth: 2 }, dir);
      const ids = deep.upstream.map((n) => n.noteId).sort();
      expect(ids).toEqual(["note-1", "note-2"]);
      expect(deep.upstream.find((n) => n.noteId === "note-1")?.depth).toBe(2);
    });
  });
});
