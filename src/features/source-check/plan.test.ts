import { describe, expect, it } from "vitest";
import { planSourceCheck } from "./plan";

describe("planSourceCheck", () => {
  it("出典を共有する知見が同じグループにまとまる", () => {
    const plan = planSourceCheck([
      { id: "claim-1", derivedFromNotes: ["note-a"] },
      { id: "claim-2", derivedFromNotes: ["note-a", "note-b"] },
      { id: "claim-3", derivedFromNotes: ["note-b"] },
    ]);

    const groupA = plan.groups.find((g) => g.sourceId === "note-a");
    const groupB = plan.groups.find((g) => g.sourceId === "note-b");
    expect(groupA?.claimIds).toEqual(["claim-1", "claim-2"]);
    expect(groupB?.claimIds).toEqual(["claim-2", "claim-3"]);
    expect(plan.claimCount).toBe(3);
  });

  it("derivedFromNotes が空/未指定の知見はどのグループにも属さない", () => {
    const plan = planSourceCheck([
      { id: "claim-1", derivedFromNotes: [] },
      { id: "claim-2" },
    ]);
    expect(plan.groups).toEqual([]);
    expect(plan.claimCount).toBe(2);
  });

  it("llmCalls は chat: など解決不能と分かっている出典を差し引く", () => {
    const plan = planSourceCheck([
      { id: "claim-1", derivedFromNotes: ["note-a", "chat:123", "pdf:file-1"] },
    ]);
    // note-a / pdf:file-1 は「試みる価値がある」= llmCalls に数える。chat:123 は除外。
    expect(plan.groups.length).toBe(3);
    expect(plan.llmCalls).toBe(2);
  });

  it("shared:/data:/image: が混入していても llmCalls から除外される（防御的）", () => {
    const plan = planSourceCheck([
      { id: "claim-1", derivedFromNotes: ["shared:x", "data:y", "image:z", "url:https://example.com"] },
    ]);
    expect(plan.groups.length).toBe(4);
    expect(plan.llmCalls).toBe(1);
  });
});
