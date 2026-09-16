// topics.ts（ナレッジ層の索引と 2 ホップの辿り）の回帰テスト。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getTopicDetail, listTopics, resolveTopicEntry } from "./topics";
import { resetSearchIndex } from "./search";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";
import type { GraphiumDocument } from "../lib/document-types";

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: overrides.noteId ?? "note-1",
    title: overrides.title ?? "テストノート",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    source: "human",
    ...overrides,
  };
}

function paragraph(id: string, t: string) {
  return {
    id,
    type: "paragraph",
    props: {},
    content: [{ type: "text", text: t, styles: {} }],
    children: [],
  };
}

function heading(id: string, t: string) {
  return {
    id,
    type: "heading",
    props: { level: 2 },
    content: [{ type: "text", text: t, styles: {} }],
    children: [],
  };
}

function makeDoc(overrides: Partial<GraphiumDocument> = {}): GraphiumDocument {
  return {
    version: 6,
    title: "ドキュメント",
    pages: [{ id: "page-1", title: "page", blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildVault(
  dir: string,
  docs: Record<string, GraphiumDocument>,
  entries: NoteIndexEntry[],
): void {
  const notesDirPath = join(dir, "notes");
  const wikiDirPath = join(dir, "wiki");
  const appdata = join(dir, "appdata");
  mkdirSync(notesDirPath, { recursive: true });
  mkdirSync(wikiDirPath, { recursive: true });
  mkdirSync(appdata, { recursive: true });
  const entryById = new Map(entries.map((e) => [e.noteId, e]));
  for (const [noteId, doc] of Object.entries(docs)) {
    const dest = entryById.get(noteId)?.source === "ai" ? wikiDirPath : notesDirPath;
    writeFileSync(join(dest, `${noteId}.json`), JSON.stringify(doc), "utf8");
  }
  const index: GraphiumIndex = {
    version: 1,
    updatedAt: "2026-09-01T00:00:00.000Z",
    notes: entries,
  };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
}

describe("topics", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-topics-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  const noteDoc = makeDoc({
    pages: [
      {
        id: "page-1",
        title: "page",
        blocks: [paragraph("p1", "焼結でクラックが入った。")],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  });

  const claimDoc = makeDoc({
    title: "知見: 昇温速度とクラック",
    source: "ai",
    wikiMeta: {
      kind: "claim",
      derivedFromNotes: ["note-1"],
      derivedFromChats: [],
      generatedAt: "2026-09-01T00:00:00.000Z",
      generatedBy: { model: "test", version: "1" },
      topicIds: ["topic-1"],
    },
    pages: [
      { id: "page-1", title: "page", blocks: [paragraph("p1", "昇温速度が速いとクラックが入る。")], labels: {}, provLinks: [], knowledgeLinks: [] },
    ],
  });

  const topicDoc = makeDoc({
    title: "焼結条件",
    source: "ai",
    wikiMeta: {
      kind: "topic",
      derivedFromNotes: [],
      derivedFromChats: [],
      generatedAt: "2026-09-01T00:00:00.000Z",
      generatedBy: { model: "test", version: "1" },
      derivedFromClaims: ["claim-1"],
    },
    pages: [
      {
        id: "page-1",
        title: "page",
        blocks: [heading("h1", "定義"), paragraph("p1", "焼結条件は昇温速度と保持時間からなる。")],
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
  });

  function seedVault() {
    buildVault(
      dir,
      { "note-1": noteDoc, "claim-1": claimDoc, "topic-1": topicDoc },
      [
        makeEntry({ noteId: "note-1", title: "実験ノート" }),
        makeEntry({
          noteId: "claim-1",
          title: "知見: 昇温速度とクラック",
          source: "ai",
          wikiKind: "claim",
          derivedFromNotes: ["note-1"],
        }),
        makeEntry({ noteId: "topic-1", title: "焼結条件", source: "ai", wikiKind: "topic" }),
      ],
    );
  }

  describe("listTopics", () => {
    it("wikiKind === topic のエントリだけを、1 行要約とメンバー件数つきで返す", () => {
      seedVault();
      const topics = listTopics({}, dir);
      expect(topics).toEqual([
        {
          topicId: "topic-1",
          title: "焼結条件",
          oneLiner: "焼結条件は昇温速度と保持時間からなる。",
          memberCount: 1,
        },
      ]);
    });

    it("トピックが無ければ空配列", () => {
      buildVault(dir, { "note-1": noteDoc }, [makeEntry({ noteId: "note-1" })]);
      expect(listTopics({}, dir)).toEqual([]);
    });
  });

  describe("resolveTopicEntry", () => {
    it("ID でもタイトルでも引ける", () => {
      seedVault();
      expect(resolveTopicEntry("topic-1", dir)?.noteId).toBe("topic-1");
      expect(resolveTopicEntry("焼結条件", dir)?.noteId).toBe("topic-1");
    });

    it("見つからなければ null", () => {
      seedVault();
      expect(resolveTopicEntry("存在しない", dir)).toBeNull();
    });
  });

  describe("getTopicDetail", () => {
    it("本文・メンバー知見・知見の出どころノートを 2 ホップで返す", () => {
      seedVault();
      const detail = getTopicDetail("topic-1", dir);
      expect(detail?.topicId).toBe("topic-1");
      expect(detail?.title).toBe("焼結条件");
      expect(detail?.body).toContain("焼結条件は昇温速度と保持時間からなる。");
      expect(detail?.members).toEqual([
        {
          claimId: "claim-1",
          title: "知見: 昇温速度とクラック",
          sourceNotes: [{ noteId: "note-1", title: "実験ノート" }],
        },
      ]);
    });

    it("タイトルでも引ける", () => {
      seedVault();
      expect(getTopicDetail("焼結条件", dir)?.topicId).toBe("topic-1");
    });

    it("見つからなければ null", () => {
      seedVault();
      expect(getTopicDetail("存在しない", dir)).toBeNull();
    });
  });
});
