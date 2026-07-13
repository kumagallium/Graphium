// wiki 成長サマリ（summarizeWikiGrowth）の集計規則を検証する。
// 生成（wiki_ingest / wiki_atomize）は数えず、成長操作のみを数えること。

import { describe, expect, it } from "vitest";
import { summarizeWikiGrowth } from "./growth-summary";
import type { GraphiumDocument } from "../../lib/document-types";

function docWithActivities(types: string[]): GraphiumDocument {
  return {
    version: 5,
    title: "w",
    pages: [],
    documentProvenance: {
      agents: [{ id: "agent_ai_m", type: "ai", label: "m" }],
      activities: types.map((type, i) => ({
        id: `edit_${String(i + 1).padStart(3, "0")}`,
        type,
        startedAt: `2026-07-0${i + 1}T00:00:00Z`,
        endedAt: `2026-07-0${i + 1}T00:00:00Z`,
        wasAssociatedWith: "agent_ai_m",
      })),
      revisions: [],
    },
    createdAt: "2026-07-01T00:00:00Z",
    modifiedAt: "2026-07-01T00:00:00Z",
  } as unknown as GraphiumDocument;
}

describe("summarizeWikiGrowth", () => {
  it("生成のみ（ingest / atomize）の wiki は undefined（サマリを出さない）", () => {
    expect(summarizeWikiGrowth(docWithActivities(["wiki_ingest"]))).toBeUndefined();
    expect(summarizeWikiGrowth(docWithActivities(["wiki_atomize"]))).toBeUndefined();
  });

  it("成長操作を数え、最後の操作と時刻を返す", () => {
    const summary = summarizeWikiGrowth(
      docWithActivities(["wiki_ingest", "wiki_merge", "wiki_cross_update", "wiki_regenerate"]),
    );
    expect(summary).toEqual({
      count: 3,
      lastOp: "wiki_regenerate",
      lastAt: "2026-07-04T00:00:00Z",
    });
  });

  it("wiki_* 以外の操作（human_edit / ai_generation）は数えない", () => {
    const summary = summarizeWikiGrowth(
      docWithActivities(["wiki_ingest", "human_edit", "ai_generation", "wiki_merge"]),
    );
    expect(summary?.count).toBe(1);
    expect(summary?.lastOp).toBe("wiki_merge");
  });

  it("未知の wiki_* 型（将来の追加）も自動で数える", () => {
    const summary = summarizeWikiGrowth(docWithActivities(["wiki_ingest", "wiki_reinforce"]));
    expect(summary?.count).toBe(1);
    expect(summary?.lastOp).toBe("wiki_reinforce");
  });

  it("documentProvenance が無い doc / undefined は undefined", () => {
    expect(summarizeWikiGrowth(undefined)).toBeUndefined();
    expect(
      summarizeWikiGrowth({ version: 5, title: "w", pages: [] } as unknown as GraphiumDocument),
    ).toBeUndefined();
  });
});
