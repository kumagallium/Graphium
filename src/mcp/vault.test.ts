// vault.ts のパス解決とファイル読み取りの回帰テスト。
// ユーザーの実 vault には触らず、mkdtempSync で作った一時ディレクトリに fixture を組んで検証する。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveGraphiumRoot,
  readNoteIndex,
  activeNotes,
  readNote,
} from "./vault";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";

function makeEntry(overrides: Partial<NoteIndexEntry> = {}): NoteIndexEntry {
  return {
    noteId: "note-1",
    title: "テストノート",
    modifiedAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...overrides,
  };
}

describe("vault", () => {
  let dir: string;
  const originalRoot = process.env.GRAPHIUM_ROOT;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    // GRAPHIUM_ROOT を書き換えたテストの後始末（実 vault を汚さないため必須）
    if (originalRoot === undefined) delete process.env.GRAPHIUM_ROOT;
    else process.env.GRAPHIUM_ROOT = originalRoot;
  });

  describe("resolveGraphiumRoot", () => {
    it("GRAPHIUM_ROOT が設定されていればそれを使う", () => {
      process.env.GRAPHIUM_ROOT = dir;
      expect(resolveGraphiumRoot()).toBe(dir);
    });
  });

  describe("readNoteIndex", () => {
    it("存在しないファイルなら null を返す", () => {
      expect(readNoteIndex(dir)).toBeNull();
    });

    it("壊れた JSON なら null を返す", () => {
      const appdata = join(dir, "appdata");
      mkdirSync(appdata, { recursive: true });
      writeFileSync(join(appdata, "note-index.json"), "{ not valid json", "utf8");
      expect(readNoteIndex(dir)).toBeNull();
    });

    it("正しい note-index.json を読める", () => {
      const appdata = join(dir, "appdata");
      mkdirSync(appdata, { recursive: true });
      const index: GraphiumIndex = {
        version: 1,
        updatedAt: "2026-08-01T00:00:00.000Z",
        notes: [makeEntry()],
      };
      writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
      const parsed = readNoteIndex(dir);
      expect(parsed?.notes).toHaveLength(1);
      expect(parsed?.notes[0].noteId).toBe("note-1");
    });
  });

  describe("activeNotes", () => {
    it("deletedAt / archivedAt / source:skill のエントリを除外する", () => {
      const index: GraphiumIndex = {
        version: 1,
        updatedAt: "2026-08-01T00:00:00.000Z",
        notes: [
          makeEntry({ noteId: "n-active" }),
          makeEntry({ noteId: "n-deleted", deletedAt: "2026-08-01T00:00:00.000Z" }),
          makeEntry({ noteId: "n-archived", archivedAt: "2026-08-01T00:00:00.000Z" }),
          makeEntry({ noteId: "n-skill", source: "skill" }),
        ],
      };
      const active = activeNotes(index);
      expect(active.map((n) => n.noteId)).toEqual(["n-active"]);
    });
  });

  describe("readNote", () => {
    it("notes/ に無ければ wiki/ を見る", () => {
      const wikiDirPath = join(dir, "wiki");
      mkdirSync(wikiDirPath, { recursive: true });
      const doc = { version: 6, title: "Wiki note", pages: [] };
      writeFileSync(join(wikiDirPath, "note-1.json"), JSON.stringify(doc), "utf8");

      const result = readNote("note-1", dir);
      expect(result?.title).toBe("Wiki note");
    });

    it("notes/ にあればそちらを優先する", () => {
      const notesDirPath = join(dir, "notes");
      const wikiDirPath = join(dir, "wiki");
      mkdirSync(notesDirPath, { recursive: true });
      mkdirSync(wikiDirPath, { recursive: true });
      writeFileSync(
        join(notesDirPath, "note-1.json"),
        JSON.stringify({ version: 6, title: "Notes note", pages: [] }),
        "utf8",
      );
      writeFileSync(
        join(wikiDirPath, "note-1.json"),
        JSON.stringify({ version: 6, title: "Wiki note", pages: [] }),
        "utf8",
      );

      const result = readNote("note-1", dir);
      expect(result?.title).toBe("Notes note");
    });

    it("どちらにも無ければ null を返す", () => {
      expect(readNote("missing", dir)).toBeNull();
    });
  });
});
