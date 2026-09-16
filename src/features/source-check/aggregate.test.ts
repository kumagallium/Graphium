import { describe, expect, it } from "vitest";
import { aggregateDocumentVerdict, aggregateVerdict } from "./aggregate";
import type { SourceCheckEntry } from "../../lib/document-types";

function entry(verdict: SourceCheckEntry["verdict"]): SourceCheckEntry {
  return { sourceId: `s-${verdict}`, sourceKind: "note", verdict, rationale: "x" };
}

describe("aggregateVerdict", () => {
  it("entries が空なら source-missing", () => {
    expect(aggregateVerdict([])).toBe("source-missing");
  });

  it("contradicted が 1 件でもあれば他の verdict に関わらず contradicted が勝つ", () => {
    const entries = [entry("supported"), entry("contradicted"), entry("not-in-source")];
    expect(aggregateVerdict(entries)).toBe("contradicted");
  });

  it("contradicted が無ければ supported が 1 件でもあれば supported", () => {
    const entries = [entry("unclear"), entry("supported"), entry("not-in-source")];
    expect(aggregateVerdict(entries)).toBe("supported");
  });

  it("supported/contradicted が無ければ not-in-source が unclear より優先", () => {
    const entries = [entry("unclear"), entry("not-in-source")];
    expect(aggregateVerdict(entries)).toBe("not-in-source");
  });

  it("unclear と source-missing だけなら unclear", () => {
    const entries = [entry("source-missing"), entry("unclear")];
    expect(aggregateVerdict(entries)).toBe("unclear");
  });

  it("全 entries が source-missing なら source-missing", () => {
    const entries = [entry("source-missing"), entry("source-missing")];
    expect(aggregateVerdict(entries)).toBe("source-missing");
  });
});

describe("aggregateDocumentVerdict（ドキュメントの文ごとの判定をまとめる）", () => {
  it("文が 1 つ（知見）なら、その文の判定がそのまま残る", () => {
    expect(aggregateDocumentVerdict(["supported"])).toBe("supported");
    expect(aggregateDocumentVerdict(["not-in-source"])).toBe("not-in-source");
  });

  it("支持された文があっても、出典に見当たらない文があればそちらを出す（トピックで問題を隠さない）", () => {
    expect(aggregateDocumentVerdict(["supported", "not-in-source"])).toBe("not-in-source");
  });

  it("注意が要る順: contradicted > not-in-source > unclear > source-missing > supported", () => {
    expect(aggregateDocumentVerdict(["not-in-source", "contradicted", "supported"])).toBe("contradicted");
    expect(aggregateDocumentVerdict(["unclear", "source-missing", "supported"])).toBe("unclear");
    expect(aggregateDocumentVerdict(["source-missing", "supported"])).toBe("source-missing");
  });

  it("文が無ければ source-missing", () => {
    expect(aggregateDocumentVerdict([])).toBe("source-missing");
  });
});
