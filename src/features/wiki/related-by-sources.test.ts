import { describe, it, expect } from "vitest";
import { findRelatedBySharedSources } from "./related-by-sources";
import type { WikiMetaSummary } from "../../lib/document-types";

const meta = (title: string, kind: WikiMetaSummary["kind"], sources: string[]): WikiMetaSummary =>
  ({ title, kind, derivedFromNotes: sources } as WikiMetaSummary);

describe("findRelatedBySharedSources", () => {
  const metas = new Map<string, WikiMetaSummary>([
    ["t1", meta("焼結", "topic", ["pdf:a", "pdf:b"])],
    ["t2", meta("粒成長", "topic", ["pdf:a", "pdf:b", "pdf:c"])],
    ["t3", meta("密度", "topic", ["pdf:c"])],
    ["t4", meta("無関係", "topic", ["note-9"])],
    ["s1", meta("論文 A", "summary", ["pdf:a"])],
    ["q1", meta("なぜ密度が上がるか", "answer", ["pdf:b"])],
    ["c1", meta("知見", "claim", ["pdf:a"])],
    ["legacy", meta("旧トピック", "topic", [])],
  ]);
  const files = [...metas.keys()].map((id) => ({ id }));

  it("同じ資料を共有するページを、共有本数の多い順に返す（自分と知見・資料の無いページは除く）", () => {
    const r = findRelatedBySharedSources("t1", files, metas);
    expect(r.map((p) => [p.id, p.shared])).toEqual([["t2", 2], ["q1", 1], ["s1", 1]]);
    expect(r.map((p) => p.id)).not.toContain("t1");
    expect(r.map((p) => p.id)).not.toContain("c1");
    expect(r.map((p) => p.id)).not.toContain("t4");
  });

  it("要約ページからは、その資料を引く話題・問答が出る", () => {
    expect(findRelatedBySharedSources("s1", files, metas).map((p) => p.id)).toEqual(["t1", "t2"]);
  });

  it("ゴミ箱・アーカイブ済み（wikiFiles に無い）ページは出ない", () => {
    const r = findRelatedBySharedSources("t1", files.filter((f) => f.id !== "t2"), metas);
    expect(r.map((p) => p.id)).toEqual(["q1", "s1"]);
  });

  it("資料を持たないページ・知見・存在しない id は空", () => {
    expect(findRelatedBySharedSources("legacy", files, metas)).toEqual([]);
    expect(findRelatedBySharedSources("c1", files, metas)).toEqual([]);
    expect(findRelatedBySharedSources("nope", files, metas)).toEqual([]);
  });
});
