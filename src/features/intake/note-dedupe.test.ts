// note-dedupe.ts のテスト（「同じ中身のファイルを入れ直してもノートを増やさない」規則）

import { describe, it, expect } from "vitest";
import { candidateNoteIds, findExistingImport } from "./note-dedupe";
import type { NoteIndexEntry } from "../navigation/index-file";

function entry(overrides: Partial<NoteIndexEntry> & { noteId: string; title: string }): NoteIndexEntry {
  return {
    modifiedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    headings: [],
    labels: [],
    outgoingLinks: [],
    ...overrides,
  };
}

describe("candidateNoteIds", () => {
  it("タイトルが一致するノートを候補にする", () => {
    const index = [entry({ noteId: "a", title: "実験メモ" }), entry({ noteId: "b", title: "別のメモ" })];
    expect(candidateNoteIds(index, "実験メモ")).toEqual(["a"]);
  });

  it("大文字小文字を無視する", () => {
    const index = [entry({ noteId: "a", title: "Note Title" })];
    expect(candidateNoteIds(index, "note title")).toEqual(["a"]);
  });

  it("NFC/NFD の差を無視する（macOS のファイル名は NFD になり得る）", () => {
    // "が" を NFD（か + 濁点結合文字）で表現したタイトル
    const nfdTitle = "実験メモ".normalize("NFD");
    const index = [entry({ noteId: "a", title: nfdTitle })];
    expect(candidateNoteIds(index, "実験メモ".normalize("NFC"))).toEqual(["a"]);
  });

  it("削除済み・アーカイブ済みのノートは候補にしない", () => {
    const index = [
      entry({ noteId: "a", title: "メモ", deletedAt: "2026-01-02T00:00:00.000Z" }),
      entry({ noteId: "b", title: "メモ", archivedAt: "2026-01-02T00:00:00.000Z" }),
      entry({ noteId: "c", title: "メモ" }),
    ];
    expect(candidateNoteIds(index, "メモ")).toEqual(["c"]);
  });

  it("一致するノートが無ければ空配列", () => {
    expect(candidateNoteIds([entry({ noteId: "a", title: "メモ" })], "別の名前")).toEqual([]);
  });
});

describe("findExistingImport", () => {
  it("ハッシュが一致する候補があれば noteId を返す", () => {
    const candidates = [
      { noteId: "a", importSource: { path: "a.md", contentHash: "sha256:aaa", importedAt: "2026-01-01T00:00:00.000Z" } },
      { noteId: "b", importSource: { path: "b.md", contentHash: "sha256:bbb", importedAt: "2026-01-01T00:00:00.000Z" } },
    ];
    expect(findExistingImport(candidates, "sha256:bbb")).toBe("b");
  });

  it("importSource を持たない候補（手で作ったノート）は無視する", () => {
    const candidates = [{ noteId: "a" }, { noteId: "b", importSource: { path: "b.md", contentHash: "sha256:bbb", importedAt: "x" } }];
    expect(findExistingImport(candidates, "sha256:bbb")).toBe("b");
  });

  it("一致するものが無ければ null", () => {
    const candidates = [{ noteId: "a", importSource: { path: "a.md", contentHash: "sha256:aaa", importedAt: "x" } }];
    expect(findExistingImport(candidates, "sha256:zzz")).toBeNull();
  });

  it("候補が空でも null", () => {
    expect(findExistingImport([], "sha256:aaa")).toBeNull();
  });
});
