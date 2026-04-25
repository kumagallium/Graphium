import { describe, it, expect } from "vitest";
import { parseQuery, searchNotes } from "./search";
import type { NoteIndexEntry } from "../navigation/index-file";

function entry(partial: Partial<NoteIndexEntry> & { noteId: string; title: string }): NoteIndexEntry {
  return {
    noteId: partial.noteId,
    title: partial.title,
    modifiedAt: partial.modifiedAt ?? "2026-04-25T00:00:00.000Z",
    createdAt: partial.createdAt ?? "2026-04-01T00:00:00.000Z",
    headings: partial.headings ?? [],
    labels: partial.labels ?? [],
    outgoingLinks: partial.outgoingLinks ?? [],
    source: partial.source,
    wikiKind: partial.wikiKind,
    author: partial.author,
    model: partial.model,
  };
}

describe("parseQuery()", () => {
  it("splits free text from #label and @author tokens", () => {
    const r = parseQuery("XRD #手順 @claude");
    expect(r.text).toBe("XRD");
    expect(r.labelTokens).toEqual(["手順"]);
    expect(r.authorTokens).toEqual(["claude"]);
  });

  it("returns empty arrays when only free text", () => {
    const r = parseQuery("Hello world");
    expect(r.text).toBe("Hello world");
    expect(r.labelTokens).toEqual([]);
    expect(r.authorTokens).toEqual([]);
  });

  it("ignores stand-alone # / @", () => {
    const r = parseQuery("# @ hello");
    expect(r.text).toBe("# @ hello");
    expect(r.labelTokens).toEqual([]);
    expect(r.authorTokens).toEqual([]);
  });
});

describe("searchNotes()", () => {
  const notes: NoteIndexEntry[] = [
    entry({ noteId: "a", title: "XRD analysis standard procedure", modifiedAt: "2026-04-25T00:00:00.000Z", labels: [{ blockId: "1", label: "procedure", preview: "" }] }),
    entry({ noteId: "b", title: "Design notes", modifiedAt: "2026-04-20T00:00:00.000Z" }),
    entry({ noteId: "c", title: "XRD raw log 2026-04", modifiedAt: "2026-04-24T00:00:00.000Z" }),
    entry({ noteId: "d", title: "Claude session", modifiedAt: "2026-04-23T00:00:00.000Z", author: "kumagai", model: "claude-opus-4-7" }),
    entry({ noteId: "e", title: "Wiki page on XRD", modifiedAt: "2026-04-22T00:00:00.000Z", source: "ai", wikiKind: "concept" }),
    entry({ noteId: "f", title: "Misc", modifiedAt: "2026-04-21T00:00:00.000Z",
      headings: [{ blockId: "h1", text: "About XRD measurement", level: 2 }] }),
  ];

  it("returns recent notes for empty query", () => {
    const hits = searchNotes("", notes, { limit: 3 });
    expect(hits).toHaveLength(3);
    expect(hits[0].entry.noteId).toBe("a"); // 2026-04-25 latest
    expect(hits[1].entry.noteId).toBe("c"); // 2026-04-24
    expect(hits[2].entry.noteId).toBe("d"); // 2026-04-23
  });

  it("ranks title-prefix above title-contains", () => {
    const hits = searchNotes("xrd", notes);
    // "XRD analysis..." prefix-matches; others contain
    expect(hits[0].entry.noteId).toBe("a");
    expect(hits.map((h) => h.entry.noteId)).toContain("c");
    expect(hits.map((h) => h.entry.noteId)).toContain("e");
    expect(hits.map((h) => h.entry.noteId)).toContain("f");
  });

  it("supports heading match when title misses", () => {
    const hits = searchNotes("measurement", notes);
    expect(hits.map((h) => h.entry.noteId)).toContain("f");
    expect(hits.find((h) => h.entry.noteId === "f")?.reasons).toContain("heading");
  });

  it("filters by #label using core key", () => {
    const hits = searchNotes("#procedure", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["a"]);
  });

  it("filters by @author / model substring", () => {
    const hits = searchNotes("@claude", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["d"]);
  });

  it("combines free text + #label", () => {
    const hits = searchNotes("xrd #procedure", notes);
    expect(hits.map((h) => h.entry.noteId)).toEqual(["a"]);
  });

  it("excludes by includeSources option", () => {
    const hits = searchNotes("xrd", notes, { includeSources: ["human"] });
    expect(hits.map((h) => h.entry.noteId)).not.toContain("e");
  });

  it("returns empty when query has no matches", () => {
    const hits = searchNotes("zzz-no-match", notes);
    expect(hits).toEqual([]);
  });

  it("records titleMatches ranges for highlighting", () => {
    const hits = searchNotes("xrd", notes);
    const a = hits.find((h) => h.entry.noteId === "a")!;
    expect(a.titleMatches.length).toBeGreaterThan(0);
    expect(a.titleMatches[0]).toEqual({ start: 0, end: 3 });
  });
});
