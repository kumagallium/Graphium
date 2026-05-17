import { describe, expect, it } from "vitest";
import {
  buildPlanAndExecutionNotes,
  withPartOfPlanNoteId,
} from "./plan-execution-builder";
import type { MatProvOutput } from "../../server/services/prov-ingester-profiles";

const sourceMeta = {
  paperTitle: "Test paper",
  sourceUrl: "https://example.com/paper",
  sourceTitle: "Test paper",
  sourceFetchedAt: "2026-05-17T00:00:00.000Z",
};

const singleProcedure: MatProvOutput = [
  {
    label: "Cu_simple",
    "@graph": [
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "sealing" }] },
      { "@type": "Entity", "@id": "e1", label: [{ "@value": "Cu" }], type: [{ "@value": "material" }] },
      { "@type": "Usage", activity: "a1", entity: "e1" },
    ],
  },
];

const multiProcedure: MatProvOutput = [
  {
    label: "Cu2-deltaS",
    "@graph": [
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "sealing" }] },
    ],
  },
  {
    label: "Cu2-deltaFexS",
    "@graph": [
      { "@type": "Activity", "@id": "a1", label: [{ "@value": "sealing" }] },
    ],
  },
];

describe("buildPlanAndExecutionNotes", () => {
  it("1 procedure では plan ノートを作らない", () => {
    const r = buildPlanAndExecutionNotes(singleProcedure, sourceMeta);
    expect(r.planNote).toBeNull();
    expect(r.executionNotes).toHaveLength(1);
    expect(r.executionNotes[0].title).toBe("Cu_simple");
    expect(r.executionNotes[0].sourceUrl).toBe("https://example.com/paper");
  });

  it("複数 procedure では plan + 各実施ノートを返す", () => {
    const r = buildPlanAndExecutionNotes(multiProcedure, sourceMeta);
    expect(r.planNote).not.toBeNull();
    expect(r.executionNotes).toHaveLength(2);
    expect(r.procedureLabels).toEqual(["Cu2-deltaS", "Cu2-deltaFexS"]);
    expect(r.planNote!.title).toBe("Test paper");
    // plan ノート本文にプロシージャ名が含まれる（bullet list）
    const planText = JSON.stringify(r.planNote!.pages[0].blocks);
    expect(planText).toContain("Cu2-deltaS");
    expect(planText).toContain("Cu2-deltaFexS");
  });

  it("空配列は両方空で返す", () => {
    const r = buildPlanAndExecutionNotes([], sourceMeta);
    expect(r.planNote).toBeNull();
    expect(r.executionNotes).toHaveLength(0);
  });
});

describe("withPartOfPlanNoteId", () => {
  it("partOfPlanNoteId を付与した新オブジェクトを返す", () => {
    const r = buildPlanAndExecutionNotes(singleProcedure, sourceMeta);
    const original = r.executionNotes[0];
    expect(original.partOfPlanNoteId).toBeUndefined();
    const patched = withPartOfPlanNoteId(original, "plan-123");
    expect(patched.partOfPlanNoteId).toBe("plan-123");
    expect(original.partOfPlanNoteId).toBeUndefined();
  });
});
