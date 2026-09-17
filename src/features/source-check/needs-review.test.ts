// buildNeedsReviewList / isNeedsReviewVerdict のテスト。
// 対象: kind が claim/topic かつ verdict が contradicted/not-in-source、dismissed でないもの。
// アーカイブ・ゴミ箱は wikiFiles（呼び出し側で除外済み）に含めないことで担保される。

import { describe, it, expect } from "vitest";
import { buildNeedsReviewList, isNeedsReviewVerdict } from "./needs-review";
import type { WikiMetaSummary } from "../../lib/document-types";

function meta(overrides: Partial<WikiMetaSummary> & { title: string; kind: WikiMetaSummary["kind"] }): WikiMetaSummary {
  return overrides;
}

describe("isNeedsReviewVerdict", () => {
  it("contradicted / not-in-source を要確認と判定する", () => {
    expect(isNeedsReviewVerdict({ verdict: "contradicted", claimHash: "h" })).toBe(true);
    expect(isNeedsReviewVerdict({ verdict: "not-in-source", claimHash: "h" })).toBe(true);
  });

  it("supported / unclear / source-missing は要確認ではない", () => {
    expect(isNeedsReviewVerdict({ verdict: "supported", claimHash: "h" })).toBe(false);
    expect(isNeedsReviewVerdict({ verdict: "unclear", claimHash: "h" })).toBe(false);
    expect(isNeedsReviewVerdict({ verdict: "source-missing", claimHash: "h" })).toBe(false);
  });

  it("dismissed は要確認から除外する", () => {
    expect(isNeedsReviewVerdict({ verdict: "contradicted", dismissed: true, claimHash: "h" })).toBe(false);
  });

  it("ミラーが無ければ false", () => {
    expect(isNeedsReviewVerdict(undefined)).toBe(false);
  });
});

describe("buildNeedsReviewList", () => {
  it("claim / topic のみを対象にする（atom/synthesis/summary は除外）", () => {
    const files = [{ id: "c1" }, { id: "a1" }, { id: "t1" }];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", meta({ title: "知見1", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
      ["a1", meta({ title: "アトム1", kind: "atom", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
      ["t1", meta({ title: "トピック1", kind: "topic", sourceCheckVerdict: { verdict: "not-in-source", claimHash: "h" } })],
    ]);
    const result = buildNeedsReviewList(files, metas);
    expect(result.map((r) => r.id)).toEqual(["c1", "t1"]);
  });

  it("dismissed / supported / 未照合は除外する", () => {
    const files = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", meta({ title: "知見1", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", dismissed: true, claimHash: "h" } })],
      ["c2", meta({ title: "知見2", kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h" } })],
      ["c3", meta({ title: "知見3", kind: "claim" })],
    ]);
    expect(buildNeedsReviewList(files, metas)).toEqual([]);
  });

  it("並びは contradicted → not-in-source、同じ判定内はタイトル順", () => {
    const files = [{ id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", meta({ title: "b-not-in-source", kind: "claim", sourceCheckVerdict: { verdict: "not-in-source", claimHash: "h" } })],
      ["c2", meta({ title: "a-not-in-source", kind: "claim", sourceCheckVerdict: { verdict: "not-in-source", claimHash: "h" } })],
      ["c3", meta({ title: "b-contradicted", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
      ["c4", meta({ title: "a-contradicted", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
    ]);
    const result = buildNeedsReviewList(files, metas);
    expect(result.map((r) => r.id)).toEqual(["c4", "c3", "c2", "c1"]);
  });

  it("wikiFiles に無いエントリ（アーカイブ・ゴミ箱で除外済み）は含まれない", () => {
    const files = [{ id: "c1" }];
    const metas = new Map<string, WikiMetaSummary>([
      ["c1", meta({ title: "知見1", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
      ["c2", meta({ title: "アーカイブ済み", kind: "claim", sourceCheckVerdict: { verdict: "contradicted", claimHash: "h" } })],
    ]);
    expect(buildNeedsReviewList(files, metas).map((r) => r.id)).toEqual(["c1"]);
  });
});
