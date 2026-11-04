// おまかせで照合する — 手当ての対象と中身を決める純関数のテスト
import { describe, it, expect } from "vitest";
import type { SourceCheckProfile } from "../../lib/document-types";
import { collectSourceCheckFixTargets, isFixed, planSourceCheckFixes } from "./auto-fix";
import type { NeedsReviewEntry } from "./needs-review";

function profile(verdict: SourceCheckProfile["verdict"], dismissed?: boolean): SourceCheckProfile {
  return { verdict, entries: [], checkedAt: "2026-11-04T00:00:00Z", checkedBy: "m", claimHash: "h", ...(dismissed ? { dismissed } : {}) };
}

const metas: Record<string, { kind: string; title: string }> = {
  c1: { kind: "claim", title: "発酵は 28℃ で 1 時間" },
  t1: { kind: "topic", title: "パンの発酵" },
  a1: { kind: "answer", title: "なぜ膨らむ？" },
  s1: { kind: "summary", title: "資料の要約" },
  x1: { kind: "atom", title: "洞察" },
};
const metaOf = (id: string) => metas[id];

describe("collectSourceCheckFixTargets", () => {
  it("照合前の要確認と今回の要確認を合わせる", () => {
    const before: NeedsReviewEntry[] = [{ id: "t1", title: "パンの発酵", kind: "topic", verdict: "not-in-source" }];
    const fresh = new Map([["c1", profile("contradicted")]]);
    const targets = collectSourceCheckFixTargets(before, fresh, metaOf);
    expect(targets.map((t) => t.id)).toEqual(["c1", "t1"]);
  });

  it("今回の照合で出典に書かれていると分かったものは直さない", () => {
    const before: NeedsReviewEntry[] = [{ id: "t1", title: "パンの発酵", kind: "topic", verdict: "not-in-source" }];
    const fresh = new Map([["t1", profile("supported")]]);
    expect(collectSourceCheckFixTargets(before, fresh, metaOf)).toEqual([]);
  });

  it("確認済み・判定できなかった・出典を開けなかった・照合の対象外の種類は直さない", () => {
    const fresh = new Map([
      ["c1", profile("contradicted", true)],
      ["t1", profile("unclear")],
      ["a1", profile("source-missing")],
      ["x1", profile("contradicted")],
    ]);
    expect(collectSourceCheckFixTargets([], fresh, metaOf)).toEqual([]);
  });

  it("出典と異なる → 見当たらない、同じ判定の中はタイトル順", () => {
    const fresh = new Map([
      ["s1", profile("not-in-source")],
      ["a1", profile("contradicted")],
      ["t1", profile("not-in-source")],
    ]);
    expect(collectSourceCheckFixTargets([], fresh, metaOf).map((t) => t.id)).toEqual(["a1", "t1", "s1"]);
  });
});

describe("planSourceCheckFixes", () => {
  it("知見はアーカイブ、それ以外は資料から作り直す", () => {
    const steps = planSourceCheckFixes([
      { id: "c1", title: "発酵は 28℃ で 1 時間", kind: "claim", verdict: "contradicted" },
      { id: "t1", title: "パンの発酵", kind: "topic", verdict: "not-in-source" },
      { id: "a1", title: "なぜ膨らむ？", kind: "answer", verdict: "not-in-source" },
      { id: "s1", title: "資料の要約", kind: "summary", verdict: "not-in-source" },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["archive", "rewrite", "rewrite", "rewrite"]);
  });
});

describe("isFixed", () => {
  it("作り直してもまだ合わないものは直したと数えない", () => {
    const step = { kind: "rewrite" as const, wikiId: "t1", title: "パンの発酵" };
    expect(isFixed({ step, ok: true })).toBe(true);
    expect(isFixed({ step, ok: true, stillFlagged: true })).toBe(false);
    expect(isFixed({ step, ok: false })).toBe(false);
  });
});
