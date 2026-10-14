import { describe, expect, it } from "vitest";
import {
  canWriteRationale,
  comparatorLabel,
  formatFrameValue,
  hasFrameToShow,
  hasInferredFrame,
  resolveFrameClaimLinks,
} from "./frame-view";
import type { DecisionFrame, WikiMeta, WikiMetaSummary } from "../../lib/document-types";

const label = (k: string) => `L:${k.split(".").pop()}`;

describe("comparatorLabel", () => {
  it("記号がある比較子は記号、無いものは i18n の語", () => {
    expect(comparatorLabel("ge", label)).toBe("≥");
    expect(comparatorLabel("eq", label)).toBe("=");
    expect(comparatorLabel("increases", label)).toBe("L:increases");
  });
});

describe("formatFrameValue", () => {
  it("無い欄は飛ばして 1 行にする", () => {
    expect(formatFrameValue({ item: "温度", comparator: "ge", value: 300, unit: "K", span: "x" }, label)).toBe("温度 ≥ 300 K");
    expect(formatFrameValue({ item: "収率", comparator: "increases", span: "x" }, label)).toBe("収率 L:increases");
    expect(formatFrameValue({ item: "色", span: "x" }, label)).toBe("色");
  });
});

describe("resolveFrameClaimLinks", () => {
  const metas = new Map<string, WikiMetaSummary>([["a", { title: "知見A", kind: "claim" } as WikiMetaSummary]]);
  it("解決できたものは wiki: 付き、できないものは label 空の無効リンク、重複は除く", () => {
    expect(resolveFrameClaimLinks(["a", "a", "zz"], metas)).toEqual([
      { id: "a", label: "知見A", resolved: true, navigateId: "wiki:a" },
      { id: "zz", label: "", resolved: false, navigateId: "" },
    ]);
  });
  it("undefined / 空は空配列", () => {
    expect(resolveFrameClaimLinks(undefined, metas)).toEqual([]);
  });
});

describe("frame 判定", () => {
  const base = { kind: "claim" } as unknown as WikiMeta;
  const dec = (rationale: string | null, reviewState: "extracted" | "inferred" = "extracted"): DecisionFrame =>
    ({ triggerClaimIds: [], action: "a", rationale, reviewState });
  it("frame が無ければ出さない", () => {
    expect(hasFrameToShow(base)).toBe(false);
    expect(hasFrameToShow({ ...base, ruleFrame: { conditions: [], consequences: [], reviewState: "extracted" } })).toBe(true);
  });
  it("理由を書けるのは null かつ通常ノート出典ありのときだけ", () => {
    expect(canWriteRationale({ ...base, decisionFrame: dec(null), derivedFromNotes: ["n1"] })).toBe(true);
    expect(canWriteRationale({ ...base, decisionFrame: dec(null), derivedFromNotes: ["pdf:x"] })).toBe(false);
    expect(canWriteRationale({ ...base, decisionFrame: dec("r"), derivedFromNotes: ["n1"] })).toBe(false);
  });
  it("inferred の検出", () => {
    expect(hasInferredFrame({ ...base, decisionFrame: dec("r", "inferred") })).toBe(true);
    expect(hasInferredFrame({ ...base, decisionFrame: dec("r") })).toBe(false);
  });
});
