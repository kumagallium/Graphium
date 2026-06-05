import { describe, it, expect } from "vitest";
import { selectNoteScopedWikiIds } from "./note-scope";

describe("selectNoteScopedWikiIds", () => {
  const candidates = [
    { id: "claim-1", derivedFromNotes: ["note-A"] },          // note-A 由来の Claim
    { id: "claim-2", derivedFromNotes: ["note-B"] },          // 別ノート由来
    { id: "summary-A", derivedFromNotes: ["note-A"] },        // note-A 由来の Summary
    { id: "insight-1", derivedFromNotes: [] },                 // 複数ノート横断（derivedFromClaims 経由）
  ];

  it("includes only knowledge directly derived from the open note", () => {
    const scope = selectNoteScopedWikiIds("note-A", candidates);
    expect([...scope].sort()).toEqual(["claim-1", "summary-A"]);
  });

  it("excludes knowledge derived from other notes", () => {
    const scope = selectNoteScopedWikiIds("note-A", candidates);
    expect(scope.has("claim-2")).toBe(false);
  });

  it("excludes cross-note Insights/Ideas (empty derivedFromNotes)", () => {
    const scope = selectNoteScopedWikiIds("note-A", candidates);
    expect(scope.has("insight-1")).toBe(false);
  });

  it("includes the root itself when the open note is a wiki note", () => {
    const scope = selectNoteScopedWikiIds("claim-1", candidates);
    expect(scope.has("claim-1")).toBe(true);
  });

  it("returns all candidates as a fallback when root is null", () => {
    const scope = selectNoteScopedWikiIds(null, candidates);
    expect(scope.size).toBe(candidates.length);
  });

  it("returns an empty scope when the note has no derived knowledge", () => {
    const scope = selectNoteScopedWikiIds("note-Z", candidates);
    expect(scope.size).toBe(0);
  });
});
