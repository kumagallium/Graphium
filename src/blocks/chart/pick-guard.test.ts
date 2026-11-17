import { describe, expect, it } from "vitest";
import { shouldApplyAssetPick } from "./pick-guard";

describe("shouldApplyAssetPick", () => {
  it("ブロックがあれば書く", () => {
    expect(shouldApplyAssetPick({ blockExists: true })).toBe(true);
  });
  it("待つ間にブロックが消えたら書かない", () => {
    expect(shouldApplyAssetPick({ blockExists: false })).toBe(false);
  });
});

import { createPickQueue } from "./pick-guard";

describe("createPickQueue", () => {
  it("後から入れた確定は、先の確定が終わってから走る（捨てない）", async () => {
    const queue = createPickQueue();
    const log: string[] = [];
    const slow = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      log.push("first");
    });
    const fast = queue.enqueue(async () => {
      log.push("second");
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(["first", "second"]);
  });

  it("失敗しても次の確定は走り、reject は外に出ない", async () => {
    const errors: unknown[] = [];
    const queue = createPickQueue((e) => errors.push(e));
    const log: string[] = [];
    await queue.enqueue(async () => {
      throw new Error("boom");
    });
    await queue.enqueue(async () => {
      log.push("after");
    });
    expect(errors).toHaveLength(1);
    expect(log).toEqual(["after"]);
  });

  it("onError が throw しても、後続の確定は走る", async () => {
    const queue = createPickQueue(() => {
      throw new Error("onError boom");
    });
    const log: string[] = [];
    await queue.enqueue(async () => {
      throw new Error("job boom");
    });
    await queue.enqueue(async () => {
      log.push("after");
    });
    expect(log).toEqual(["after"]);
  });
});
