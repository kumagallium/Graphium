// おまかせで照合する — 手当ての対象と中身を決める純関数のテスト
import { describe, it, expect } from "vitest";
import type { SourceCheckProfile } from "../../lib/document-types";
import { collectSourceCheckFixTargets, hasUnbackedStatement, isFixed, planSourceCheckFixes, stillNeedsFix } from "./auto-fix";
import type { NeedsReviewEntry } from "./needs-review";

function profile(verdict: SourceCheckProfile["verdict"], dismissed?: boolean): SourceCheckProfile {
  return { verdict, entries: [{ sourceId: "n", sourceKind: "note", verdict, rationale: "r" }], checkedAt: "2026-11-04T00:00:00Z", checkedBy: "m", claimHash: "h", ...(dismissed ? { dismissed } : {}) };
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
    const targets = collectSourceCheckFixTargets(before, fresh, metaOf, () => profile("not-in-source"));
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
      { id: "c1", title: "発酵は 28℃ で 1 時間", kind: "claim", verdict: "contradicted", fix: "unbacked" },
      { id: "t1", title: "パンの発酵", kind: "topic", verdict: "not-in-source", fix: "unbacked" },
      { id: "a1", title: "なぜ膨らむ？", kind: "answer", verdict: "not-in-source", fix: "unbacked" },
      { id: "s1", title: "資料の要約", kind: "summary", verdict: "not-in-source", fix: "unbacked" },
      { id: "c2", title: "割れている知見", kind: "claim", verdict: "contradicted", fix: "disagree" },
    ]);
    expect(steps.map((s) => s.kind)).toEqual(["archive", "rewrite", "rewrite", "rewrite", "reconcile"]);
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

describe("資料どうしで割れているものは併記し、裏づけの無いものは作り直す", () => {
  const entry = (sourceId: string, verdict: SourceCheckProfile["verdict"], statementBlockId?: string) => ({
    sourceId, sourceKind: "note" as const, verdict, rationale: "r", ...(statementBlockId ? { statementBlockId } : {}),
  });
  const withEntries = (entries: SourceCheckProfile["entries"]): SourceCheckProfile => ({
    ...profile(entries.some((e) => e.verdict === "contradicted") ? "contradicted" : "not-in-source"),
    entries,
  });

  it("9 件が裏づけて 1 件が食い違う知見は、アーカイブせず併記する", () => {
    const p = withEntries([
      ...Array.from({ length: 9 }, (_, i) => entry(`n${i}`, "supported")),
      entry("n9", "contradicted"),
    ]);
    expect(hasUnbackedStatement(p)).toBe(false);
    const targets = collectSourceCheckFixTargets([], new Map([["c1", p]]), metaOf);
    expect(targets.map((t) => [t.id, t.fix])).toEqual([["c1", "disagree"]]);
    expect(planSourceCheckFixes(targets)).toEqual([{ kind: "reconcile", wikiId: "c1", title: "発酵は 28℃ で 1 時間" }]);
    expect(stillNeedsFix(p)).toBe(true);
    expect(stillNeedsFix(withEntries([entry("n1", "supported")]))).toBe(false);
  });

  it("裏づける出典が 1 つも無い知見は直す", () => {
    const p = withEntries([entry("n1", "contradicted"), entry("n2", "not-in-source")]);
    expect(collectSourceCheckFixTargets([], new Map([["c1", p]]), metaOf).map((t) => t.id)).toEqual(["c1"]);
  });

  it("トピックは文ごとに見る。裏づけの無い文が 1 つでもあれば作り直す", () => {
    const split = withEntries([entry("n1", "supported", "b1"), entry("n2", "contradicted", "b1")]);
    expect(hasUnbackedStatement(split)).toBe(false);
    const oneUnbacked = withEntries([
      entry("n1", "supported", "b1"), entry("n2", "contradicted", "b1"),
      entry("n1", "not-in-source", "b2"),
    ]);
    expect(hasUnbackedStatement(oneUnbacked)).toBe(true);
  });

  it("前から要確認だったものも保存済みの判定で手当てを決め、読めないものは直さない", () => {
    const before: NeedsReviewEntry[] = [
      { id: "c1", title: "発酵は 28℃ で 1 時間", kind: "claim", verdict: "contradicted" },
      { id: "t1", title: "パンの発酵", kind: "topic", verdict: "not-in-source" },
      { id: "a1", title: "なぜ膨らむ？", kind: "answer", verdict: "not-in-source" },
    ];
    const saved = new Map<string, SourceCheckProfile>([
      ["c1", withEntries([entry("n1", "supported"), entry("n2", "contradicted")])],
      ["t1", withEntries([entry("n1", "not-in-source", "b1")])],
    ]);
    const targets = collectSourceCheckFixTargets(before, new Map(), metaOf, (id) => saved.get(id));
    expect(targets.map((t) => [t.id, t.fix])).toEqual([["c1", "disagree"], ["t1", "unbacked"]]);
  });
});
