// folders.ts（list_folders のフォルダの木）の回帰テスト。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listFolders } from "./folders";
import { resetSearchIndex } from "./search";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";

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

function minimalDoc(title: string) {
  return {
    version: 4,
    title,
    pages: [{ id: "p", title, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
    createdAt: "2026-09-01T00:00:00.000Z",
    modifiedAt: "2026-09-01T00:00:00.000Z",
  };
}

function buildVault(dir: string, entries: NoteIndexEntry[], emptyFolders?: unknown): void {
  const notes = join(dir, "notes");
  const wiki = join(dir, "wiki");
  const appdata = join(dir, "appdata");
  mkdirSync(notes, { recursive: true });
  mkdirSync(wiki, { recursive: true });
  mkdirSync(appdata, { recursive: true });
  for (const e of entries) {
    const dest = e.source === "ai" ? wiki : notes;
    writeFileSync(join(dest, `${e.noteId}.json`), JSON.stringify(minimalDoc(e.title)), "utf8");
  }
  const index: GraphiumIndex = { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", notes: entries };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
  if (emptyFolders !== undefined) {
    writeFileSync(join(appdata, "folders.json"), JSON.stringify(emptyFolders), "utf8");
  }
}

describe("listFolders", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-folders-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  it("タグから 2 階層の木を組み、件数は子を含めて数える", () => {
    buildVault(dir, [
      makeEntry({ noteId: "a", noteContexts: ["研究"] }),
      makeEntry({ noteId: "b", noteContexts: ["研究/熱電"] }),
      makeEntry({ noteId: "c", noteContexts: ["研究/熱電"] }),
      makeEntry({ noteId: "d", noteContexts: ["AI 会話"] }),
      makeEntry({ noteId: "e" }),
    ]);
    const { folders, unfiledCount } = listFolders(dir);
    expect(folders.map((f) => [f.path, f.totalCount])).toEqual([
      ["AI 会話", 1],
      ["研究", 3],
    ]);
    const research = folders.find((f) => f.path === "研究")!;
    expect(research.children.map((c) => [c.path, c.totalCount])).toEqual([["研究/熱電", 2]]);
    expect(unfiledCount).toBe(1);
  });

  it("ナレッジ層・ゴミ箱・アーカイブ・Skill は数えない", () => {
    buildVault(dir, [
      makeEntry({ noteId: "a", noteContexts: ["研究"] }),
      makeEntry({ noteId: "w", source: "ai", wikiKind: "topic", noteContexts: ["研究"] }),
      makeEntry({ noteId: "t", noteContexts: ["研究"], deletedAt: "2026-09-02T00:00:00.000Z" }),
      makeEntry({ noteId: "r", noteContexts: ["古い"], archivedAt: "2026-09-02T00:00:00.000Z" }),
      makeEntry({ noteId: "s", source: "skill", noteContexts: ["スキル"] }),
    ]);
    const { folders } = listFolders(dir);
    expect(folders.map((f) => [f.path, f.totalCount])).toEqual([["研究", 1]]);
  });

  it("appdata/folders.json の空フォルダも出す（大文字小文字は名寄せ）", () => {
    buildVault(dir, [makeEntry({ noteId: "a", noteContexts: ["Research"] })], {
      version: 1,
      folders: ["research", "下書き", "研究/熱電"],
    });
    const { folders } = listFolders(dir);
    expect(folders.map((f) => [f.path, f.totalCount])).toEqual([
      ["Research", 1],
      ["下書き", 0],
      ["研究", 0],
    ]);
    expect(folders.find((f) => f.path === "研究")!.children.map((c) => c.path)).toEqual(["研究/熱電"]);
  });

  it("folders.json が壊れている・版違いなら空フォルダ無しとして扱う", () => {
    buildVault(dir, [makeEntry({ noteId: "a", noteContexts: ["研究"] })], { version: 99, folders: ["x"] });
    expect(listFolders(dir).folders.map((f) => f.path)).toEqual(["研究"]);

    writeFileSync(join(dir, "appdata", "folders.json"), "{not json", "utf8");
    expect(listFolders(dir).folders.map((f) => f.path)).toEqual(["研究"]);
  });
});
