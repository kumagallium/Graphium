import { describe, expect, it } from "vitest";
import { shouldApplyAssetPick } from "./pick-guard";

describe("shouldApplyAssetPick", () => {
  it("ブロックがあり、最後の確定なら書く", () => {
    expect(shouldApplyAssetPick({ blockExists: true, seq: 3, latestSeq: 3 })).toBe(true);
  });
  it("待つ間にブロックが消えたら書かない", () => {
    expect(shouldApplyAssetPick({ blockExists: false, seq: 3, latestSeq: 3 })).toBe(false);
  });
  it("待つ間に別の確定が入ったら古い方は書かない", () => {
    expect(shouldApplyAssetPick({ blockExists: true, seq: 2, latestSeq: 3 })).toBe(false);
  });
});
