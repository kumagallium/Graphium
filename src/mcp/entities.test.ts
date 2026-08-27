// entities.ts の横断集約ロジックの回帰テスト。
// search.ts の allEntries() がプロセス内キャッシュを持つため、各テスト前に resetSearchIndex() で捨てる。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeEntityText, listEntities, findNotesUsing } from "./entities";
import { resetSearchIndex } from "./search";
import type { GraphiumIndex, NoteIndexEntry } from "../features/navigation/index-file";

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

/** 一時 vault を組み立て、notes/ と appdata/note-index.json を書く */
function buildVault(dir: string, entries: NoteIndexEntry[]): void {
  const notesDirPath = join(dir, "notes");
  const appdata = join(dir, "appdata");
  mkdirSync(notesDirPath, { recursive: true });
  mkdirSync(appdata, { recursive: true });
  for (const entry of entries) {
    writeFileSync(
      join(notesDirPath, `${entry.noteId}.json`),
      JSON.stringify({ version: 6, title: entry.title, pages: [] }),
      "utf8",
    );
  }
  const index: GraphiumIndex = {
    version: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
    notes: entries,
  };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
}

describe("normalizeEntityText", () => {
  it("全角/半角・大文字小文字・前後空白を吸収する", () => {
    expect(normalizeEntityText("　ＮａＣｌ　")).toBe(normalizeEntityText("nacl"));
    expect(normalizeEntityText("NaCl")).toBe("nacl");
    expect(normalizeEntityText("  Water  ")).toBe("water");
  });
});

describe("entities（listEntities / findNotesUsing）", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  it("listEntities が横断件数の多い順に並び、minNotes で単発を落とす", () => {
    buildVault(dir, [
      makeEntry({
        noteId: "n1",
        title: "ノート1",
        inlineLabels: [
          { blockId: "b1", label: "material", text: "NaCl", entityId: "e1" },
        ],
      }),
      makeEntry({
        noteId: "n2",
        title: "ノート2",
        inlineLabels: [
          { blockId: "b2", label: "material", text: "NaCl", entityId: "e2" },
        ],
      }),
      makeEntry({
        noteId: "n3",
        title: "ノート3",
        inlineLabels: [
          { blockId: "b3", label: "material", text: "単発の材料", entityId: "e3" },
        ],
      }),
    ]);

    const all = listEntities({}, dir);
    // NaCl は 2 ノート、単発の材料は 1 ノート → NaCl が先頭
    expect(all[0].text).toBe("NaCl");
    expect(all[0].noteCount).toBe(2);

    const filtered = listEntities({ minNotes: 2 }, dir);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].text).toBe("NaCl");
  });

  it("findNotesUsing が text の部分一致で引ける", () => {
    buildVault(dir, [
      makeEntry({
        noteId: "n1",
        inlineLabels: [
          { blockId: "b1", label: "material", text: "塩化ナトリウム水溶液", entityId: "e1" },
        ],
      }),
    ]);

    const hits = findNotesUsing({ text: "ナトリウム" }, dir);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("塩化ナトリウム水溶液");
  });

  it("findNotesUsing の partial: false で完全一致のみになる", () => {
    buildVault(dir, [
      makeEntry({
        noteId: "n1",
        inlineLabels: [
          { blockId: "b1", label: "material", text: "塩化ナトリウム水溶液", entityId: "e1" },
        ],
      }),
    ]);

    expect(findNotesUsing({ text: "ナトリウム", partial: false }, dir)).toHaveLength(0);
    expect(
      findNotesUsing({ text: "塩化ナトリウム水溶液", partial: false }, dir),
    ).toHaveLength(1);
  });

  it("findNotesUsing が entityId でも引ける", () => {
    buildVault(dir, [
      makeEntry({
        noteId: "n1",
        inlineLabels: [
          { blockId: "b1", label: "material", text: "NaCl", entityId: "entity-abc" },
        ],
      }),
    ]);

    const hits = findNotesUsing({ entityId: "entity-abc" }, dir);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("NaCl");
  });
});
