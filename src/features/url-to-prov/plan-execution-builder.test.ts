import { describe, expect, it } from "vitest";
import {
  buildPlanAndExecutionNotes,
  withPartOfPlanNoteId,
} from "./plan-execution-builder";
import type { ProvIngesterOutput } from "../../server/services/prov-ingester";

const sourceMeta = {
  paperTitle: "Test paper",
  sourceUrl: "https://example.com/paper",
  sourceTitle: "Test paper",
  sourceFetchedAt: "2026-05-18T00:00:00.000Z",
};

const single: ProvIngesterOutput[] = [
  {
    title: "Cu_simple",
    blocks: [
      {
        blockType: "heading",
        level: 2,
        role: "procedure",
        stepId: "sealing",
        text: "Sealing",
      },
      {
        blockType: "paragraph",
        content: [
          { text: "Seal " },
          { text: "Cu", role: "material" },
          { text: " in the tube." },
        ],
      },
    ],
  },
];

const multi: ProvIngesterOutput[] = [
  {
    title: "Cu2-deltaS",
    blocks: [
      { blockType: "heading", level: 2, text: "Sealing", role: "procedure", stepId: "sealing" },
    ],
  },
  {
    title: "Cu2-deltaFexS",
    blocks: [
      { blockType: "heading", level: 2, text: "Sealing", role: "procedure", stepId: "sealing" },
    ],
  },
];

describe("buildPlanAndExecutionNotes", () => {
  it("1 procedure では plan ノートを作らない", () => {
    const r = buildPlanAndExecutionNotes(single, sourceMeta);
    expect(r.planNote).toBeNull();
    expect(r.executionNotes).toHaveLength(1);
    expect(r.executionNotes[0].title).toBe("Cu_simple");
    expect(r.executionNotes[0].sourceUrl).toBe("https://example.com/paper");
  });

  it("複数 procedure では plan + 各実施ノートを返す", () => {
    const r = buildPlanAndExecutionNotes(multi, sourceMeta);
    expect(r.planNote).not.toBeNull();
    expect(r.executionNotes).toHaveLength(2);
    expect(r.procedureLabels).toEqual(["Cu2-deltaS", "Cu2-deltaFexS"]);
    expect(r.planNote!.title).toBe("Test paper");
    const planText = JSON.stringify(r.planNote!.pages[0].blocks);
    expect(planText).toContain("Cu2-deltaS");
    expect(planText).toContain("Cu2-deltaFexS");
  });

  it("title が空の procedure は連番ラベルでフォールバック", () => {
    const withoutTitle: ProvIngesterOutput[] = [
      { title: "", blocks: multi[0].blocks },
      { title: "Cu2-deltaFexS", blocks: multi[1].blocks },
    ];
    const r = buildPlanAndExecutionNotes(withoutTitle, sourceMeta);
    expect(r.procedureLabels[0]).toBe("Procedure 1");
    expect(r.procedureLabels[1]).toBe("Cu2-deltaFexS");
  });

  it("空配列は両方空で返す", () => {
    const r = buildPlanAndExecutionNotes([], sourceMeta);
    expect(r.planNote).toBeNull();
    expect(r.executionNotes).toHaveLength(0);
  });
});

describe("withPartOfPlanNoteId", () => {
  it("partOfPlanNoteId を付与した新オブジェクトを返す", () => {
    const r = buildPlanAndExecutionNotes(single, sourceMeta);
    const original = r.executionNotes[0];
    expect(original.partOfPlanNoteId).toBeUndefined();
    const patched = withPartOfPlanNoteId(original, "plan-123");
    expect(patched.partOfPlanNoteId).toBe("plan-123");
    expect(original.partOfPlanNoteId).toBeUndefined();
  });
});
