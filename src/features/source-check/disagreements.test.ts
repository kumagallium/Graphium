import { describe, it, expect } from "vitest";
import type { SourceCheckEntry, SourceCheckProfile } from "../../lib/document-types";
import { buildDisagreements, hasDisagreement } from "./disagreements";

function entry(sourceId: string, verdict: SourceCheckEntry["verdict"], extra: Partial<SourceCheckEntry> = {}): SourceCheckEntry {
  return { sourceId, sourceKind: "note", verdict, rationale: `r-${sourceId}`, ...extra } as SourceCheckEntry;
}
function profile(entries: SourceCheckEntry[]): SourceCheckProfile {
  return { verdict: "contradicted", entries, checkedAt: "2026-01-01T00:00:00Z", checkedBy: "local", claimHash: "h" };
}
const titleOf = (id: string) => (id === "s0" ? "資料0" : undefined);

describe("buildDisagreements", () => {
  it("9 件 supported + 1 件 contradicted は 1 件の食い違い", () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => entry(`s${i}`, "supported")),
      entry("x1", "contradicted", { quote: "q" }),
    ];
    const p = profile(entries);
    expect(hasDisagreement(p)).toBe(true);
    const d = buildDisagreements(p, titleOf);
    expect(d).toHaveLength(1);
    expect(d[0].supporting).toHaveLength(9);
    expect(d[0].contradicting).toHaveLength(1);
    expect(d[0].supporting[0].sourceTitle).toBe("資料0");
    expect(d[0].contradicting[0]).toMatchObject({ sourceTitle: "x1", quote: "q", rationale: "r-x1" });
    expect(d[0].statement).toBeUndefined();
  });

  it("supported だけなら 0 件", () => {
    const p = profile([entry("a", "supported"), entry("b", "supported")]);
    expect(hasDisagreement(p)).toBe(false);
    expect(buildDisagreements(p, titleOf)).toEqual([]);
  });

  it("contradicted だけなら 0 件（裏づけ無しは併記の対象ではない）", () => {
    const p = profile([entry("a", "contradicted"), entry("b", "not-in-source")]);
    expect(hasDisagreement(p)).toBe(false);
    expect(buildDisagreements(p, titleOf)).toEqual([]);
  });

  it("トピックの文 2 つで片方だけ食い違うなら 1 件で statement が入る", () => {
    const p = profile([
      entry("a", "supported", { statement: "文1", statementBlockId: "b1" }),
      entry("b", "supported", { statement: "文2", statementBlockId: "b2" }),
      entry("c", "contradicted", { statement: "文2", statementBlockId: "b2" }),
    ]);
    const d = buildDisagreements(p, titleOf);
    expect(d).toHaveLength(1);
    expect(d[0].statement).toBe("文2");
    expect(d[0].supporting.map((s) => s.sourceId)).toEqual(["b"]);
    expect(d[0].contradicting.map((s) => s.sourceId)).toEqual(["c"]);
  });
});
