// note-dedupe.ts のテスト（「同じ中身のファイルを入れ直してもノートを増やさない」規則）

import { describe, it, expect } from "vitest";
import { findExistingImportId } from "./note-dedupe";
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

describe("findExistingImportId", () => {
  it("ハッシュが一致するノートがあれば noteId を返す", () => {
    const index = [
      entry({ noteId: "a", title: "実験メモ", importSourceHash: "sha256:aaa" }),
      entry({ noteId: "b", title: "別のメモ", importSourceHash: "sha256:bbb" }),
    ];
    expect(findExistingImportId(index, "sha256:bbb")).toBe("b");
  });

  it("ファイル名が変わっていても中身のハッシュが一致すれば重複と判定する（リネーム耐性）", () => {
    // タイトルは元のファイル名由来だが、リネーム後は一致しない想定
    const index = [entry({ noteId: "a", title: "Meeting Notes", importSourceHash: "sha256:aaa" })];
    expect(findExistingImportId(index, "sha256:aaa")).toBe("a");
  });

  it("importSourceHash を持たないノート（手で作った・投入口以外の経路）は無視する", () => {
    const index = [
      entry({ noteId: "a", title: "手書きメモ" }),
      entry({ noteId: "b", title: "投入口メモ", importSourceHash: "sha256:bbb" }),
    ];
    expect(findExistingImportId(index, "sha256:bbb")).toBe("b");
  });

  it("削除済み・アーカイブ済みのノートは対象にしない", () => {
    const index = [
      entry({ noteId: "a", title: "メモ", importSourceHash: "sha256:aaa", deletedAt: "2026-01-02T00:00:00.000Z" }),
      entry({ noteId: "b", title: "メモ", importSourceHash: "sha256:aaa", archivedAt: "2026-01-02T00:00:00.000Z" }),
      entry({ noteId: "c", title: "メモ", importSourceHash: "sha256:aaa" }),
    ];
    expect(findExistingImportId(index, "sha256:aaa")).toBe("c");
  });

  it("一致するハッシュが無ければ null", () => {
    const index = [entry({ noteId: "a", title: "メモ", importSourceHash: "sha256:aaa" })];
    expect(findExistingImportId(index, "sha256:zzz")).toBeNull();
  });

  it("index が空でも null", () => {
    expect(findExistingImportId([], "sha256:aaa")).toBeNull();
  });
});
