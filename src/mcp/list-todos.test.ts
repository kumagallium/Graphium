// list-todos.ts の回帰テスト。索引（note-index.json）だけから組むので、ノート本体は最小で済む。

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectTodos, listTodos } from "./list-todos";
import { resetSearchIndex } from "./search";
import { INDEX_SCHEMA_VERSION, type GraphiumIndex, type NoteIndexEntry } from "../features/navigation/index-file";

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
function buildVault(dir: string, entries: NoteIndexEntry[], version = INDEX_SCHEMA_VERSION): void {
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
  const index: GraphiumIndex = { version, updatedAt: "2026-08-01T00:00:00.000Z", notes: entries };
  writeFileSync(join(appdata, "note-index.json"), JSON.stringify(index), "utf8");
}

describe("collectTodos / listTodos", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "graphium-mcp-todos-"));
    resetSearchIndex();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    resetSearchIndex();
  });

  it("未チェックの項目だけを、更新の新しいノートから順に返す", () => {
    buildVault(dir, [
      makeEntry({
        noteId: "old",
        title: "古いノート",
        modifiedAt: "2026-07-01T00:00:00.000Z",
        checklist: [
          { blockId: "a1", text: "試薬を注文する", checked: false },
          { blockId: "a2", text: "装置を予約する", checked: true },
        ],
      }),
      makeEntry({
        noteId: "new",
        title: "新しいノート",
        modifiedAt: "2026-09-01T00:00:00.000Z",
        noteContexts: ["電池/正極"],
        checklist: [{ blockId: "b1", text: "XRD を取る", checked: false, links: ["https://tasks.example/9"] }],
      }),
      makeEntry({ noteId: "none", title: "項目なし" }),
    ]);

    const notes = collectTodos({}, dir);
    expect(notes.map((n) => n.noteId)).toEqual(["new", "old"]);
    expect(notes[1].items).toEqual([{ noteId: "old", blockId: "a1", text: "試薬を注文する", checked: false }]);

    const out = listTodos({}, dir);
    expect(out).toContain("まだチェックしていない項目（2 件・2 ノート）");
    expect(out).toContain("## 新しいノート  [noteId: new]");
    expect(out).toContain("フォルダ: 電池/正極");
    expect(out).toContain("- [ ] XRD を取る  [blockId: b1]  → https://tasks.example/9");
    expect(out).not.toContain("装置を予約する");
  });

  it("includeDone でチェック済みも返し、[x] で示す", () => {
    buildVault(dir, [
      makeEntry({
        checklist: [
          { blockId: "a1", text: "注文", checked: false },
          { blockId: "a2", text: "予約", checked: true },
        ],
      }),
    ]);
    const out = listTodos({ includeDone: true }, dir);
    expect(out).toContain("- [ ] 注文  [blockId: a1]");
    expect(out).toContain("- [x] 予約  [blockId: a2]");
  });

  it("folder はそのフォルダと子フォルダに絞り、大文字小文字と全角を区別しない", () => {
    buildVault(dir, [
      makeEntry({ noteId: "p1", noteContexts: ["Plan/電池"], checklist: [{ blockId: "c1", text: "a", checked: false }] }),
      makeEntry({ noteId: "p2", noteContexts: ["計画"], checklist: [{ blockId: "c2", text: "b", checked: false }] }),
      makeEntry({ noteId: "x", noteContexts: ["読書"], checklist: [{ blockId: "c3", text: "c", checked: false }] }),
    ]);
    expect(collectTodos({ folder: "plan" }, dir).map((n) => n.noteId)).toEqual(["p1"]);
    expect(collectTodos({ folder: "読書" }, dir).map((n) => n.noteId)).toEqual(["x"]);
    expect(collectTodos({ noteId: "p2" }, dir).map((n) => n.noteId)).toEqual(["p2"]);
  });

  it("ナレッジ層のページ（source: ai）は対象にしない", () => {
    buildVault(dir, [
      makeEntry({ noteId: "w", source: "ai", wikiKind: "topic", checklist: [{ blockId: "c1", text: "a", checked: false }] }),
    ]);
    expect(collectTodos({}, dir)).toEqual([]);
    expect(listTodos({}, dir)).toContain("まだチェックしていない項目はありません");
  });

  it("limit を超えると件数を添えて打ち切る", () => {
    buildVault(dir, [
      makeEntry({
        checklist: Array.from({ length: 5 }, (_, i) => ({ blockId: `c${i}`, text: `項目 ${i}`, checked: false })),
      }),
    ]);
    const out = listTodos({ limit: 2 }, dir);
    expect(out).toContain("項目 1");
    expect(out).not.toContain("項目 2");
    expect(out).toContain("5 件のうち 2 件を表示");
  });

  it("索引がこの機能より古い版なら注意書きを添える", () => {
    buildVault(dir, [makeEntry({ checklist: [{ blockId: "c1", text: "a", checked: false }] })], INDEX_SCHEMA_VERSION - 1);
    const out = listTodos({}, dir);
    expect(out).toContain(`古い版（v${INDEX_SCHEMA_VERSION - 1}）`);
  });
});
