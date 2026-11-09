import { describe, expect, it } from "vitest";
import { buildPlanCheckerSystemPrompt, buildPlanCheckerUserMessage, parsePlanCheckOutput, type PlanCheckInput } from "./plan-checker";

const input: PlanCheckInput = {
  sources: [{ title: "BaFe12O19 のゾルゲル合成", text: "焼成 950 °C 4 h、大気中" }],
  answer: "焼成温度を 800〜1100 °C で振る",
  plan: "## 対象と条件\n| 対象 | 焼成温度 |\n## 焼成\n温度: 800 °C、時間: 4 h、雰囲気: アルゴン",
};

describe("plan-checker", () => {
  it("出力言語と分類の 4 種を prompt に書く", () => {
    const p = buildPlanCheckerSystemPrompt("ja");
    expect(p).toContain("Japanese");
    for (const s of ["\"source\"", "\"answer\"", "\"unsupported\"", "\"conflict\""]) expect(p).toContain(s);
  });

  it("参考ノート・回答・計画を節に分けて渡し、長い参考ノートは切る", () => {
    const long: PlanCheckInput = { ...input, sources: [{ title: "長い", text: "x".repeat(20000) }] };
    const m = buildPlanCheckerUserMessage(long);
    expect(m).toContain("### SOURCE: 長い");
    expect(m).toContain("(truncated)");
    expect(m).toContain("## ANSWER");
    expect(m).toContain("## PLAN");
  });

  it("答えを検証する（種類・状態の無いものは落とし、出典は渡した題か ANSWER だけ残す）", () => {
    const raw = `{"items": [
      {"kind": "condition", "text": "時間 4 h", "status": "source", "source": "BaFe12O19 のゾルゲル合成"},
      {"kind": "variable", "text": "焼成温度 800–1100 °C", "status": "answer"},
      {"kind": "condition", "text": "雰囲気 アルゴン", "status": "conflict", "source": "BaFe12O19 のゾルゲル合成", "detail": "大気中"},
      {"kind": "material", "text": "ZrO2", "status": "unsupported", "source": "存在しないノート"},
      {"kind": "weird", "text": "x", "status": "source"},
      {"kind": "tool", "text": "", "status": "source"},
      {"kind": "tool", "text": "電気炉", "status": "maybe"}
    ]}`;
    const items = parsePlanCheckOutput(raw, input);
    expect(items.map((i) => i.status)).toEqual(["source", "answer", "conflict", "unsupported"]);
    expect(items[2]).toMatchObject({ source: "BaFe12O19 のゾルゲル合成", detail: "大気中" });
    expect(items[3].source).toBeUndefined();
    expect(parsePlanCheckOutput("not json", input)).toEqual([]);
  });
});
