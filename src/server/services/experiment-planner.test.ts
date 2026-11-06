import { describe, expect, it } from "vitest";
import { buildExperimentPlannerSystemPrompt, parseExperimentPlanDraft } from "./experiment-planner";

describe("experiment-planner", () => {
  it("出力言語を prompt に書く", () => {
    expect(buildExperimentPlannerSystemPrompt("ja")).toContain("Japanese");
    expect(buildExperimentPlannerSystemPrompt("en")).toContain("English");
  });

  it("計画の JSON を整える（同名の行は番号で分け、未知のキーの値は捨てる）", () => {
    const raw = `\`\`\`json
{"title":"Co-Ni 置換量を振る","background":"b","expectedOutcome":"o",
 "variables":[{"key":"x","label":"置換量 x","unit":""},{"key":"x","label":"dup"}],
 "runs":[{"name":"x = 0","values":{"x":"0","y":"9"}},{"name":"x = 0","values":{"x":0.2}}],
 "procedure":"BaCO3 と Fe2O3 を混ぜる。x: 0"}
\`\`\``;
    const plan = parseExperimentPlanDraft(raw)!;
    expect(plan.variables).toEqual([{ key: "x", label: "置換量 x" }]);
    expect(plan.runs).toEqual([
      { name: "x = 0", values: { x: "0" } },
      { name: "x = 0 (2)", values: { x: "0.2" } },
    ]);
    expect(plan.procedure).toContain("BaCO3");
  });

  it("題・手順・行のどれかが無ければ使えない", () => {
    expect(parseExperimentPlanDraft(`{"title":"t","runs":[],"procedure":"p"}`)).toBeNull();
    expect(parseExperimentPlanDraft(`{"title":"","runs":[{"name":"a"}],"procedure":"p"}`)).toBeNull();
    expect(parseExperimentPlanDraft("nothing")).toBeNull();
  });
});
