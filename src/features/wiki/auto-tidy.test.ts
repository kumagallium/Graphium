import { describe, expect, it } from "vitest";
import type { LintIssue, LintReport } from "../../server/services/wiki-linter";
import { countLeftoverIssues, leftoverReport, planAutoTidy } from "./auto-tidy";

function issue(partial: Partial<LintIssue> & Pick<LintIssue, "type" | "affectedWikiIds">): LintIssue {
  return { severity: "warning", title: "t", description: "d", suggestion: "s", ...partial };
}

function report(issues: LintIssue[]): LintReport {
  return {
    issues,
    summary: { total: issues.length, contradictions: 0, orphans: 0, gaps: 0, stale: 0, redundant: 0, missingSource: 0 },
    analyzedAt: "2026-11-04T00:00:00.000Z",
  };
}

const kinds = new Map<string, string>([
  ["t1", "topic"], ["t2", "topic"], ["t3", "topic"],
  ["a1", "atom"], ["a2", "atom"],
  ["c1", "claim"],
]);

describe("planAutoTidy", () => {
  it("統合・作り直しに加え、矛盾は両側に・古いページは古い側だけに併記し、孤立はアーカイブする", () => {
    const r = report([
      issue({ type: "redundant", affectedWikiIds: ["t1", "t2"], recommendedAction: { type: "merge", keepId: "t1", absorbId: "t2" } }),
      issue({ type: "contradiction", affectedWikiIds: ["a1", "a2"], title: "a1 と a2 が矛盾", description: "向きが逆" }),
      issue({ type: "missing-source", affectedWikiIds: ["t3"] }),
      issue({ type: "stale", affectedWikiIds: ["c1", "o1"], title: "c1 は古い", description: "o1 が後から" }),
      issue({ type: "orphan", affectedWikiIds: ["c2"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds, titleById: new Map([["a1", "洞察 1"], ["a2", "洞察 2"], ["o1", "新しいページ"]]) });
    expect(plan.steps).toEqual([
      { kind: "merge", mergeKind: "topic", keepId: "t1", absorbId: "t2" },
      { kind: "rebuild", wikiId: "t3" },
      { kind: "reconcile", wikiId: "a1", conflicts: [{ otherWikiId: "a2", otherTitle: "洞察 2", summary: "a1 と a2 が矛盾 — 向きが逆" }] },
      { kind: "reconcile", wikiId: "a2", conflicts: [{ otherWikiId: "a1", otherTitle: "洞察 1", summary: "a1 と a2 が矛盾 — 向きが逆" }] },
      // 古い側（c1）だけが書き換わる。追い越した o1 は触らない
      { kind: "reconcile", wikiId: "c1", conflicts: [{ otherWikiId: "o1", otherTitle: "新しいページ", summary: "c1 は古い — o1 が後から", relation: "newer" }] },
      { kind: "archive", wikiId: "c2" },
    ]);
    expect(plan.leftoverIssueIndices).toEqual([]);
    expect(plan.suggestedIssueIndices).toEqual([]);
  });

  it("同じページが複数の矛盾に関わるときは 1 回の併記にまとめ、他の手当てで触るページの矛盾は残す", () => {
    const r = report([
      issue({ type: "missing-source", affectedWikiIds: ["a1"] }),
      issue({ type: "contradiction", affectedWikiIds: ["a1", "a2"] }),
      issue({ type: "contradiction", affectedWikiIds: ["a2", "t1"] }),
      issue({ type: "contradiction", affectedWikiIds: ["a2", "t2"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps.map((s) => s.kind)).toEqual(["rebuild", "reconcile", "reconcile", "reconcile"]);
    const a2 = plan.steps.find((s) => s.kind === "reconcile" && s.wikiId === "a2");
    expect(a2 && a2.kind === "reconcile" ? a2.conflicts.map((c) => c.otherWikiId) : []).toEqual(["t1", "t2"]);
    // a1 は作り直すので、その矛盾は残す
    expect(plan.leftoverIssueIndices).toEqual([1]);
  });

  it("古いページ: ids が 2 件以上なら古い側（先頭）だけに newer で併記し、複数の相手は 1 回にまとめる", () => {
    const r = report([issue({ type: "stale", affectedWikiIds: ["a1", "a2", "c1", "a2"] })]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toHaveLength(1);
    const s = plan.steps[0];
    expect(s.kind === "reconcile" ? s.wikiId : null).toBe("a1");
    expect(s.kind === "reconcile" ? s.conflicts.map((c) => [c.otherWikiId, c.relation]) : []).toEqual([["a2", "newer"], ["c1", "newer"]]);
    expect(plan.leftoverIssueIndices).toEqual([]);
  });

  it("古いページ: ids が 1 件だけなら追い越した相手が分からないので手当てせず未対応に残す", () => {
    const r = report([issue({ type: "stale", affectedWikiIds: ["c1"] })]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toEqual([]);
    expect(plan.leftoverIssueIndices).toEqual([0]);
  });

  it("古いページ: 追い越した全部の見方を書き終えていれば手当て済み（steps も未対応も無し）", () => {
    const r = report([issue({ type: "stale", affectedWikiIds: ["a1", "a2", "c1"] })]);
    const all = planAutoTidy(r, { kindById: kinds, hasWrittenOtherView: (p, o) => p === "a1" && (o === "a2" || o === "c1") });
    expect(all.steps).toEqual([]);
    expect(all.leftoverIssueIndices).toEqual([]);
    // 片方だけ書き終えていても、残りがあれば併記する
    const some = planAutoTidy(r, { kindById: kinds, hasWrittenOtherView: (p, o) => p === "a1" && o === "a2" });
    expect(some.steps).toHaveLength(1);
  });

  it("古いページ: 統合などで触るページが絡むときは手当てせず残す", () => {
    const r = report([
      issue({ type: "redundant", affectedWikiIds: ["t1", "t2"], recommendedAction: { type: "merge", keepId: "t1", absorbId: "t2" } }),
      issue({ type: "stale", affectedWikiIds: ["t2", "t3"] }),
      issue({ type: "stale", affectedWikiIds: ["c1", "t1"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toEqual([{ kind: "merge", mergeKind: "topic", keepId: "t1", absorbId: "t2" }]);
    expect(plan.leftoverIssueIndices).toEqual([1, 2]);
  });

  it("同じページが矛盾と古いページの両方に出たら、1 回の併記に conflicts が合流する", () => {
    const r = report([
      issue({ type: "contradiction", affectedWikiIds: ["a1", "a2"] }),
      issue({ type: "stale", affectedWikiIds: ["a1", "c1"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps.map((s) => s.kind === "reconcile" ? s.wikiId : s.kind)).toEqual(["a1", "a2"]);
    const a1 = plan.steps[0];
    expect(a1.kind === "reconcile" ? a1.conflicts.map((c) => [c.otherWikiId, c.relation ?? "conflict"]) : []).toEqual([["a2", "conflict"], ["c1", "newer"]]);
    expect(plan.leftoverIssueIndices).toEqual([]);
  });

  it("両方に相手の見方を書き終えた矛盾は、手当てもせず未対応にも残さない", () => {
    const r = report([
      issue({ type: "contradiction", affectedWikiIds: ["a1", "a2"] }),
      issue({ type: "contradiction", affectedWikiIds: ["a1", "t1"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds, isReconciled: (a, b) => new Set([a, b]).has("a2") });
    expect(plan.steps.map((s) => s.kind === "reconcile" ? s.wikiId : s.kind)).toEqual(["a1", "t1"]);
    expect(plan.leftoverIssueIndices).toEqual([]);
  });

  it("穴は未対応に数えず、次に調べることとして分ける", () => {
    const r = report([
      issue({ type: "gap", affectedWikiIds: ["t1", "t2"] }),
      issue({ type: "orphan", affectedWikiIds: ["t1"] }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toEqual([{ kind: "archive", wikiId: "t1" }]);
    expect(plan.leftoverIssueIndices).toEqual([]);
    expect(plan.suggestedIssueIndices).toEqual([0]);
    const left = leftoverReport(r, plan.leftoverIssueIndices, plan.suggestedIssueIndices);
    expect(left.issues.map((i) => i.type)).toEqual(["gap"]);
    expect(countLeftoverIssues(left)).toBe(0);
  });

  it("推奨の無い重複・種類の違う組の統合は拾わない", () => {
    const r = report([
      issue({ type: "redundant", affectedWikiIds: ["t1", "t2"] }),
      issue({ type: "redundant", affectedWikiIds: ["t1", "a1"], recommendedAction: { type: "merge", keepId: "t1", absorbId: "a1" } }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toEqual([]);
    expect(plan.leftoverIssueIndices).toEqual([0, 1]);
  });

  it("同じページを 2 度触らない（A←B のあとの B←C は飛ばす）", () => {
    const r = report([
      issue({ type: "redundant", affectedWikiIds: ["t1", "t2"], recommendedAction: { type: "merge", keepId: "t1", absorbId: "t2" } }),
      issue({ type: "redundant", affectedWikiIds: ["t2", "t3"], recommendedAction: { type: "merge", keepId: "t2", absorbId: "t3" } }),
    ]);
    const plan = planAutoTidy(r, { kindById: kinds });
    expect(plan.steps).toEqual([{ kind: "merge", mergeKind: "topic", keepId: "t1", absorbId: "t2" }]);
    // 2 件目の統合は残す（人が見る）
    expect(plan.leftoverIssueIndices).toEqual([1]);
  });

  it("旧形式トピックは作り直しに入れ、同じトピックの資料の欠けは重ねない", () => {
    const r = report([issue({ type: "missing-source", affectedWikiIds: ["t3"] })]);
    const plan = planAutoTidy(r, { kindById: kinds, legacyTopicIds: ["t3", "t1"] });
    expect(plan.steps).toEqual([
      { kind: "rebuild", wikiId: "t3" },
      { kind: "rebuild", wikiId: "t1" },
    ]);
    expect(plan.leftoverIssueIndices).toEqual([]);
  });

  it("統合が使えないときは重複を残す", () => {
    const r = report([
      issue({ type: "redundant", affectedWikiIds: ["a1", "a2"], recommendedAction: { type: "merge", keepId: "a1", absorbId: "a2" } }),
    ]);
    expect(planAutoTidy(r, { kindById: kinds, canMergeAtoms: false }).steps).toEqual([]);
    expect(planAutoTidy(r, { kindById: kinds }).steps).toEqual([
      { kind: "merge", mergeKind: "atom", keepId: "a1", absorbId: "a2" },
    ]);
  });

  it("点検結果が無くても旧形式トピックだけは作り直す", () => {
    expect(planAutoTidy(null, { kindById: kinds, legacyTopicIds: ["t1"] })).toEqual({
      steps: [{ kind: "rebuild", wikiId: "t1" }],
      leftoverIssueIndices: [],
      suggestedIssueIndices: [],
    });
  });
});

describe("leftoverReport", () => {
  it("残した issue だけにして件数を数え直す", () => {
    const r = report([
      issue({ type: "contradiction", affectedWikiIds: ["a1"] }),
      issue({ type: "stale", affectedWikiIds: ["c1"] }),
      issue({ type: "orphan", affectedWikiIds: ["a2"] }),
    ]);
    const left = leftoverReport(r, [0, 2]);
    expect(left.issues.map((i) => i.type)).toEqual(["contradiction", "orphan"]);
    expect(left.summary).toMatchObject({ total: 2, contradictions: 1, orphans: 1, stale: 0 });
  });
});
