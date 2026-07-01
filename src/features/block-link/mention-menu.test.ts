import { describe, it, expect } from "vitest";
import { getNoteSuggestions } from "./mention-menu";
import type { GraphiumIndex, NoteIndexEntry } from "../navigation/index-file";

function note(
  noteId: string,
  title: string,
  modifiedAt: string,
  source: "human" | "ai" = "human",
): NoteIndexEntry {
  return {
    noteId,
    title,
    modifiedAt,
    createdAt: modifiedAt,
    headings: [],
    labels: [],
    outgoingLinks: [],
    source,
    ...(source === "ai" ? { wikiKind: "concept" as const } : {}),
  } as NoteIndexEntry;
}

function index(notes: NoteIndexEntry[]): GraphiumIndex {
  return { notes } as GraphiumIndex;
}

describe("getNoteSuggestions — 同名ノートの subtext", () => {
  it("同名ノートが複数あるときだけ更新日の subtext を付ける", () => {
    const idx = index([
      note("a", "新しいノート", "2026-06-30T12:00:00.000Z"),
      note("b", "新しいノート", "2026-06-28T12:00:00.000Z"),
      note("c", "会議メモ", "2026-06-29T12:00:00.000Z"),
    ]);

    const suggestions = getNoteSuggestions([], undefined, idx);

    const dups = suggestions.filter((s) => s.label === "新しいノート");
    expect(dups).toHaveLength(2);
    for (const s of dups) {
      expect(s.subtext).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const unique = suggestions.find((s) => s.label === "会議メモ");
    expect(unique?.subtext).toBeUndefined();
  });

  it("一意なタイトルには subtext を付けない", () => {
    const idx = index([
      note("a", "アイデア", "2026-06-30T12:00:00.000Z"),
      note("b", "実験計画", "2026-06-28T12:00:00.000Z"),
    ]);
    const suggestions = getNoteSuggestions([], undefined, idx);
    expect(suggestions.every((s) => s.subtext === undefined)).toBe(true);
  });

  it("files フォールバック経路でも同名を検出して subtext を付ける", () => {
    const files = [
      { id: "f1", name: "下書き.graphium.json", modifiedTime: "2026-06-30T12:00:00.000Z" },
      { id: "f2", name: "下書き.graphium.json", modifiedTime: "2026-06-20T12:00:00.000Z" },
      { id: "f3", name: "本番.graphium.json", modifiedTime: "2026-06-25T12:00:00.000Z" },
    ] as any;

    const suggestions = getNoteSuggestions(files, undefined, null);
    const dups = suggestions.filter((s) => s.label === "下書き");
    expect(dups).toHaveLength(2);
    expect(dups.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.subtext ?? ""))).toBe(true);
    expect(suggestions.find((s) => s.label === "本番")?.subtext).toBeUndefined();
  });
});
