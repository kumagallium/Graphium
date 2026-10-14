import { describe, expect, it } from "vitest";
import type { DecisionFrame, WikiMeta } from "../../lib/document-types";
import { hasAnyFrame, mergeFrame } from "./merge-frame";

const meta = (p: Partial<WikiMeta> = {}): WikiMeta => ({
  kind: "claim",
  derivedFromNotes: [],
  derivedFromChats: [],
  generatedAt: "2026-01-01T00:00:00Z",
  generatedBy: { model: "m", version: "1" },
  ...p,
});
const df = (p: Partial<DecisionFrame> = {}): DecisionFrame => ({
  triggerClaimIds: [],
  action: "A",
  rationale: null,
  reviewState: "extracted",
  ...p,
});

describe("mergeFrame", () => {
  it("existing が無ければ incoming をそのまま返す", () => {
    const inc = meta({ decisionFrame: df() });
    expect(mergeFrame(undefined, inc)).toEqual(inc);
  });

  it("a: 人が書いた理由（rationaleBy: human）は incoming が別の理由でも null でも残る", () => {
    const ex = meta({ decisionFrame: df({ rationale: "人の理由", rationaleBy: "human" }) });
    const other = mergeFrame(ex, meta({ decisionFrame: df({ rationale: "抽出の理由" }) }));
    expect(other.decisionFrame?.rationale).toBe("人の理由");
    expect(other.decisionFrame?.rationaleBy).toBe("human");
    expect(other.decisionFrame?.reviewState).toBe("extracted");
    const nul = mergeFrame(ex, meta({ decisionFrame: df({ rationale: null }) }));
    expect(nul.decisionFrame?.rationale).toBe("人の理由");
    expect(nul.decisionFrame?.rationaleBy).toBe("human");
  });

  it("a: rationaleBy が human でなければ incoming の理由が勝つ", () => {
    const ex = meta({ decisionFrame: df({ rationale: "古い" }) });
    const r = mergeFrame(ex, meta({ decisionFrame: df({ rationale: "新しい" }) }));
    expect(r.decisionFrame?.rationale).toBe("新しい");
  });

  it("a: asterism と outcome 系は既存を保持する", () => {
    const ex = meta({
      asterism: { typeSlug: "x" },
      decisionFrame: df({ outcomeClaimIds: ["o1"], outcomeAssessment: "confirmed" }),
    });
    const inc = meta({ asterism: { typeSlug: "y" }, decisionFrame: df({ action: "B" }) });
    const r = mergeFrame(ex, inc);
    expect(r.asterism).toEqual({ typeSlug: "x" });
    expect(r.decisionFrame?.outcomeClaimIds).toEqual(["o1"]);
    expect(r.decisionFrame?.outcomeAssessment).toBe("confirmed");
    expect(r.decisionFrame?.action).toBe("B");
  });

  it("a: existing に asterism が無ければ incoming を使う", () => {
    expect(mergeFrame(meta(), meta({ asterism: { typeSlug: "y" } })).asterism).toEqual({ typeSlug: "y" });
  });

  it("b: confirmed は空の欄だけ埋め、reviewState は confirmed のまま", () => {
    const ex = meta({ decisionFrame: df({ action: "keep", rationale: null, reviewState: "confirmed" }) });
    const inc = meta({ decisionFrame: df({ action: "new", rationale: "why" }) });
    const r = mergeFrame(ex, inc).decisionFrame!;
    expect(r.action).toBe("keep");
    expect(r.rationale).toBe("why");
    expect(r.reviewState).toBe("confirmed");
  });

  it("c: incoming の id 配列が空なら既存を保持する", () => {
    const ex = meta({ decisionFrame: df({ triggerClaimIds: ["t1"], rationaleRuleIds: ["r1"] }) });
    const inc = meta({ decisionFrame: df({ triggerClaimIds: [], rationaleRuleIds: undefined }) });
    const r = mergeFrame(ex, inc).decisionFrame!;
    expect(r.triggerClaimIds).toEqual(["t1"]);
    expect(r.rationaleRuleIds).toEqual(["r1"]);
  });

  it("c: incoming に id があればそれを使う", () => {
    const ex = meta({ decisionFrame: df({ triggerClaimIds: ["t1"] }) });
    const inc = meta({ decisionFrame: df({ triggerClaimIds: ["t2"] }) });
    expect(mergeFrame(ex, inc).decisionFrame?.triggerClaimIds).toEqual(["t2"]);
  });

  it("d: inferred の incoming は extracted の既存を上書きしない", () => {
    const ex = meta({ ruleFrame: { conditions: [], consequences: [], mechanism: "old", reviewState: "extracted" } });
    const inc = meta({ ruleFrame: { conditions: [], consequences: [], mechanism: "new", reviewState: "inferred" } });
    expect(mergeFrame(ex, inc).ruleFrame?.mechanism).toBe("old");
  });

  it("d: 同じ状態なら incoming が勝つ", () => {
    const ex = meta({ ruleFrame: { conditions: [], consequences: [], mechanism: "old", reviewState: "extracted" } });
    const inc = meta({ ruleFrame: { conditions: [], consequences: [], mechanism: "new", reviewState: "extracted" } });
    expect(mergeFrame(ex, inc).ruleFrame?.mechanism).toBe("new");
  });

  it("d: extracted の incoming は inferred の既存に勝つ", () => {
    const ex = meta({ observationFrame: { results: [], featureOfInterest: "old", reviewState: "inferred" } });
    const inc = meta({ observationFrame: { results: [], featureOfInterest: "new", reviewState: "extracted" } });
    expect(mergeFrame(ex, inc).observationFrame?.featureOfInterest).toBe("new");
  });

  it("e: confirmed の判断フレームがあれば claimRole に decision を戻す", () => {
    const ex = meta({ decisionFrame: df({ reviewState: "confirmed" }) });
    const inc = meta({ claimRole: ["finding"] });
    const r = mergeFrame(ex, inc);
    expect(r.claimRole).toEqual(["finding", "decision"]);
    expect(r.decisionFrame?.reviewState).toBe("confirmed");
  });

  it("e: すでに decision があれば重複して足さない／extracted でも decisionFrame が残れば decision を保証する", () => {
    const exC = meta({ decisionFrame: df({ reviewState: "confirmed" }) });
    expect(mergeFrame(exC, meta({ claimRole: ["decision"] })).claimRole).toEqual(["decision"]);
    const exE = meta({ decisionFrame: df() });
    expect(mergeFrame(exE, meta({ claimRole: ["finding"] })).claimRole).toEqual(["finding", "decision"]);
  });

  it("f: existing に frame が無ければ incoming を転記する（statementForm も）", () => {
    const inc = meta({
      statementForm: "general",
      ruleFrame: { conditions: [], consequences: [], reviewState: "extracted" },
    });
    const r = mergeFrame(meta(), inc);
    expect(r.statementForm).toBe("general");
    expect(r.ruleFrame).toBeDefined();
  });

  it("statementForm: 既存 general + 抽出 ruleFrame なし/ruleFrame あり", () => {
    const rule = { conditions: [], consequences: [], reviewState: "extracted" as const };
    const ex = meta({ statementForm: "general", ruleFrame: rule });
    const r = mergeFrame(ex, meta({ statementForm: "instance" }));
    expect(r.ruleFrame).toBeDefined();
    expect(r.statementForm).toBe("general");
  });

  it("statementForm: ruleFrame が無く observationFrame があれば instance、どちらも無ければ incoming 優先", () => {
    const obs = { featureOfInterest: "x", results: [], reviewState: "extracted" as const };
    expect(mergeFrame(meta({ observationFrame: obs }), meta({ statementForm: "general" })).statementForm).toBe("instance");
    expect(mergeFrame(meta({ statementForm: "general" }), meta({ statementForm: "instance" })).statementForm).toBe("instance");
    expect(mergeFrame(meta({ statementForm: "general" }), meta()).statementForm).toBe("general");
  });

  it("frame 以外の欄は incoming のまま", () => {
    const r = mergeFrame(meta({ language: "ja" }), meta({ language: "en" }));
    expect(r.language).toBe("en");
  });

  it("incoming に frame が無ければ既存 frame を残す", () => {
    const ex = meta({ decisionFrame: df() });
    expect(mergeFrame(ex, meta()).decisionFrame).toEqual(ex.decisionFrame);
  });
});

describe("hasAnyFrame", () => {
  it("いずれかの frame があれば true", () => {
    expect(hasAnyFrame(meta())).toBe(false);
    expect(hasAnyFrame(undefined)).toBe(false);
    expect(hasAnyFrame(meta({ observationFrame: { results: [], reviewState: "extracted" } }))).toBe(true);
  });
});
