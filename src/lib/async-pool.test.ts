import { describe, it, expect } from "vitest";
import { allSettledWithLimit } from "./async-pool";

describe("allSettledWithLimit（同時数を抑えた allSettled）", () => {
  it("同時に走る数が limit を超えず、結果は入力順で返る", async () => {
    let running = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const results = await allSettledWithLimit(items, 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1 + (n % 3)));
      running--;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual(items.map((n) => n * 2));
  });

  it("失敗した要素は rejected として同じ位置に残り、他は続く", async () => {
    const results = await allSettledWithLimit([1, 2, 3], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      return n;
    });
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect((results[1] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
  });

  it("空の配列でも落ちない", async () => {
    expect(await allSettledWithLimit([], 8, async () => 1)).toEqual([]);
  });
});
