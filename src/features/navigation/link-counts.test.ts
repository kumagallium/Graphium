// 一覧の「参照先」「被参照」「派生」の数え方（ノート一覧とナレッジ一覧で共通）

import { describe, it, expect } from "vitest";
import { buildLinkCounts, linkCountsOf } from "./link-counts";
import type { GraphiumIndex } from "./index-file";

type Row = { noteId: string; targets?: string[]; derivedFromNotes?: string[]; derivedFromClaims?: string[] };

function index(rows: Row[]): GraphiumIndex {
  return {
    notes: rows.map((r) => ({
      noteId: r.noteId,
      title: r.noteId,
      derivedFromNotes: r.derivedFromNotes,
      derivedFromClaims: r.derivedFromClaims,
      outgoingLinks: (r.targets ?? []).map((targetNoteId) => ({ targetNoteId, layer: "knowledge" as const })),
    })),
  } as unknown as GraphiumIndex;
}

describe("buildLinkCounts", () => {
  it("もと・派生の関係は参照先・被参照に数えず、派生に数える", () => {
    const counts = buildLinkCounts(
      index([
        { noteId: "n1", targets: ["n2"] },
        { noteId: "n2" },
        // 知見: もとのノート n1 を出典として引き、別の知見 c2 にも張っている
        { noteId: "c1", derivedFromNotes: ["n1"], targets: ["n1", "c2"] },
        { noteId: "c2", derivedFromNotes: ["n1"], targets: ["n1"] },
        // 洞察: もとの知見 c1・c2 を引いている
        { noteId: "a1", derivedFromClaims: ["c1", "c2"], targets: ["c1", "c2"] },
      ]),
    );
    // ノート n1: 自分から作った知見 2 件の出典リンクは被参照に入らず、派生に入る
    expect(linkCountsOf(counts, "n1")).toEqual({ outgoing: 1, incoming: 0, derived: 2 });
    expect(linkCountsOf(counts, "n2")).toEqual({ outgoing: 0, incoming: 1, derived: 0 });
    // 知見 c1: 参照先は c2 だけ。洞察 a1 は派生
    expect(linkCountsOf(counts, "c1")).toEqual({ outgoing: 1, incoming: 0, derived: 1 });
    // 知見 c2: c1 から本文で張られている（被参照 1）、洞察 a1 は派生
    expect(linkCountsOf(counts, "c2")).toEqual({ outgoing: 0, incoming: 1, derived: 1 });
    expect(linkCountsOf(counts, "a1")).toEqual({ outgoing: 0, incoming: 0, derived: 0 });
  });

  it("同じ相手を何度引いても 1 と数え、自分自身へのリンクは数えない", () => {
    const counts = buildLinkCounts(index([{ noteId: "n1", targets: ["n2", "n2", "n1"] }, { noteId: "n2" }]));
    expect(linkCountsOf(counts, "n1")).toEqual({ outgoing: 1, incoming: 0, derived: 0 });
    expect(linkCountsOf(counts, "n2").incoming).toBe(1);
  });

  it("本文でリンクしていなくても、もとにしたページは派生に数える", () => {
    const counts = buildLinkCounts(index([{ noteId: "n1" }, { noteId: "c1", derivedFromNotes: ["n1", "n1"] }]));
    expect(linkCountsOf(counts, "n1")).toEqual({ outgoing: 0, incoming: 0, derived: 1 });
  });

  it("索引とは別に渡した「もと」も合わせて使う", () => {
    const counts = buildLinkCounts(
      index([{ noteId: "c1" }, { noteId: "t1", targets: ["c1", "x"] }]),
      new Map([["t1", ["c1"]]]),
    );
    expect(linkCountsOf(counts, "t1")).toEqual({ outgoing: 1, incoming: 0, derived: 0 });
    expect(linkCountsOf(counts, "c1")).toEqual({ outgoing: 0, incoming: 0, derived: 1 });
  });

  it("索引が無いとき・索引に無いページは 0", () => {
    expect(linkCountsOf(buildLinkCounts(null), "x")).toEqual({ outgoing: 0, incoming: 0, derived: 0 });
  });
});
