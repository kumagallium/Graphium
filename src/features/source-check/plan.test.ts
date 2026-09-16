import { describe, expect, it } from "vitest";
import { planSourceCheck, type PlanSourceCheckStatement } from "./plan";

function statement(
  id: string,
  sourceIds: string[],
  extra?: Partial<PlanSourceCheckStatement>,
): PlanSourceCheckStatement {
  return { id, docId: id, title: `t-${id}`, body: `b-${id}`, hashBody: `b-${id}`, sourceIds, ...extra };
}

describe("planSourceCheck", () => {
  it("出典を共有する文が同じグループにまとまる", () => {
    const plan = planSourceCheck([
      statement("claim-1", ["note-a"]),
      statement("claim-2", ["note-a", "note-b"]),
      statement("claim-3", ["note-b"]),
    ]);

    const groupA = plan.groups.find((g) => g.sourceId === "note-a");
    const groupB = plan.groups.find((g) => g.sourceId === "note-b");
    expect(groupA?.statementIds).toEqual(["claim-1", "claim-2"]);
    expect(groupB?.statementIds).toEqual(["claim-2", "claim-3"]);
    expect(plan.statementCount).toBe(3);
    expect(plan.docCount).toBe(3);
  });

  it("sourceIds が空の文は not-recorded として knownMissing に回る（グループ化しない）", () => {
    const plan = planSourceCheck([statement("claim-1", []), statement("claim-2", ["note-a"])]);
    expect(plan.groups).toEqual([{ sourceId: "note-a", statementIds: ["claim-2"] }]);
    expect(plan.knownMissing).toEqual([
      { statementId: "claim-1", docId: "claim-1", sourceIds: [], reason: "not-recorded" },
    ]);
    expect(plan.missingCounts).toEqual({ "not-recorded": 1 });
    expect(plan.statementCount).toBe(2);
  });

  it("knownMissingReason を持つ文は sourceIds があってもグループ化せず knownMissing に回る", () => {
    const plan = planSourceCheck([statement("claim-1", ["note-a"], { knownMissingReason: "ai-answer" })]);
    expect(plan.groups).toEqual([]);
    expect(plan.knownMissing).toEqual([
      { statementId: "claim-1", docId: "claim-1", sourceIds: ["note-a"], reason: "ai-answer" },
    ]);
    expect(plan.missingCounts).toEqual({ "ai-answer": 1 });
  });

  it("llmCalls は chat: など解決不能と分かっている出典を差し引く", () => {
    const plan = planSourceCheck([statement("claim-1", ["note-a", "chat:123", "pdf:file-1"])]);
    // note-a / pdf:file-1 は「試みる価値がある」= llmCalls に数える。chat:123 は除外。
    expect(plan.groups.length).toBe(3);
    expect(plan.llmCalls).toBe(2);
  });

  it("shared:/data:/image: が混入していても llmCalls から除外される（防御的）", () => {
    const plan = planSourceCheck([
      statement("claim-1", ["shared:x", "data:y", "image:z", "url:https://example.com"]),
    ]);
    expect(plan.groups.length).toBe(4);
    expect(plan.llmCalls).toBe(1);
  });

  it("トピックの複数の文が同じ知見（claim:）を出典として共有すると 1 グループにまとまる", () => {
    const plan = planSourceCheck([
      statement("topic-1#b1", ["claim:c1"], { docId: "topic-1", statement: "文1", statementBlockId: "b1" }),
      statement("topic-2#b2", ["claim:c1"], { docId: "topic-2", statement: "文2", statementBlockId: "b2" }),
    ]);
    expect(plan.groups).toEqual([{ sourceId: "claim:c1", statementIds: ["topic-1#b1", "topic-2#b2"] }]);
    expect(plan.docCount).toBe(2);
  });
});
