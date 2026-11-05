import { describe, it, expect } from "vitest";
import type { SourceCheckEntry, SourceCheckProfile } from "../../lib/document-types";
import { buildDisagreements, buildUnbacked, hasDisagreement } from "./disagreements";

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

describe("buildUnbacked", () => {
  it("裏づけの無い文だけを集め、食い違う出典があれば contradicted・無ければ not-in-source", () => {
    const p = profile([
      entry("a", "supported", { statement: "文1", statementBlockId: "b1" }),
      entry("c", "contradicted", { statement: "文1", statementBlockId: "b1", quote: "逆" }),
      entry("s0", "contradicted", { statement: "文2", statementBlockId: "b2", quote: "出典の言い分" }),
      entry("d", "not-in-source", { statement: "文2", statementBlockId: "b2" }),
      entry("e", "not-in-source", { statement: "文3", statementBlockId: "b3" }),
      entry("f", "not-in-source", { statement: "文3", statementBlockId: "b3" }),
      entry("g", "source-missing", { statement: "文4", statementBlockId: "b4" }),
    ]);
    const u = buildUnbacked(p, titleOf);
    // 文1 は a が裏づけるので対象外（併記の側）。文4 は source-missing だけなので対象外
    expect(u.map((x) => x.statement)).toEqual(["文2", "文3"]);
    expect(u[0]).toMatchObject({ verdict: "contradicted" });
    expect(u[0].sources.map((s) => s.sourceId)).toEqual(["s0", "d"]);
    expect(u[0].sources[0]).toMatchObject({ sourceTitle: "資料0", quote: "出典の言い分", rationale: "r-s0" });
    expect(u[1]).toMatchObject({ verdict: "not-in-source" });
    expect(u[1].sources.map((s) => s.sourceId)).toEqual(["e", "f"]);
  });

  it("文の無い判定（知見）は statement 無しで 1 件", () => {
    const u = buildUnbacked(profile([entry("a", "not-in-source"), entry("b", "not-in-source")]), titleOf);
    expect(u).toHaveLength(1);
    expect(u[0].statement).toBeUndefined();
    expect(u[0].verdict).toBe("not-in-source");
  });

  it("裏づけがあるだけ・割れているだけなら 0 件", () => {
    expect(buildUnbacked(profile([entry("a", "supported")]), titleOf)).toEqual([]);
    expect(buildUnbacked(profile([entry("a", "supported"), entry("b", "contradicted")]), titleOf)).toEqual([]);
  });
});

describe("buildUnbacked — 判定できなかった出典が混ざる文", () => {
  it("見当たらないだけで unclear が混ざる文は外さない（対象にしない）。食い違いがあれば対象にする", () => {
    const p = profile([
      entry("a", "not-in-source", { statement: "文1", statementBlockId: "b1" }),
      entry("b", "unclear", { statement: "文1", statementBlockId: "b1" }),
      entry("c", "not-in-source", { statement: "文2", statementBlockId: "b2" }),
      entry("d", "source-missing", { statement: "文2", statementBlockId: "b2" }),
      entry("e", "contradicted", { statement: "文3", statementBlockId: "b3", quote: "q" }),
      entry("f", "unclear", { statement: "文3", statementBlockId: "b3" }),
    ]);
    const u = buildUnbacked(p, titleOf);
    expect(u.map((x) => x.statement)).toEqual(["文3"]);
    expect(u[0].verdict).toBe("contradicted");
  });
});
