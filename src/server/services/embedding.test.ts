// embedInBatches: 16 件ずつ送る・弾かれた文だけ切り詰めて送り直す・順序を保つ
import { describe, it, expect } from "vitest";
import { embedInBatches, EMBED_BATCH_SIZE, EMBED_FALLBACK_CHARS } from "./embedding";

const vec = (t: string) => [t.length];

function fakeEmbed(opts: { rejectOver?: number; alwaysFail?: boolean } = {}) {
  const calls: string[][] = [];
  const fn = async (texts: string[]) => {
    calls.push(texts);
    if (opts.alwaysFail) throw new Error("401 Unauthorized");
    if (opts.rejectOver !== undefined && texts.some((t) => t.length > opts.rejectOver!)) {
      throw new Error("500 Bad Request");
    }
    return { vectors: texts.map(vec), tokens: texts.length };
  };
  return { fn, calls };
}

describe("embedInBatches", () => {
  it("splits into batches of EMBED_BATCH_SIZE and keeps order", async () => {
    const texts = Array.from({ length: 40 }, (_, i) => "x".repeat(i + 1));
    const { fn, calls } = fakeEmbed();
    const r = await embedInBatches(texts, fn);
    expect(calls.map((c) => c.length)).toEqual([EMBED_BATCH_SIZE, EMBED_BATCH_SIZE, 40 - 2 * EMBED_BATCH_SIZE]);
    expect(r.vectors).toEqual(texts.map(vec));
    expect(r.tokens).toBe(40);
    expect(r.truncated).toBe(0);
  });

  it("re-sends a rejected batch one text at a time, truncating only the long ones", async () => {
    const long = "y".repeat(900);
    const texts = ["a", "bb", long, "ccc"];
    const { fn, calls } = fakeEmbed({ rejectOver: 600 });
    const r = await embedInBatches(texts, fn);
    // 1 回目: 4 件まとめて → 弾かれる。以降 1 文ずつ: a, bb, long(全文→弾かれる→500), ccc
    expect(calls[0]).toEqual(texts);
    expect(calls.slice(1).map((c) => c.length)).toEqual([1, 1, 1, 1, 1]);
    expect(r.vectors).toEqual([[1], [2], [EMBED_FALLBACK_CHARS[0]], [3]]);
    expect(r.truncated).toBe(1);
  });

  it("falls through the shorter tiers until one is accepted", async () => {
    const long = "z".repeat(900);
    const { fn } = fakeEmbed({ rejectOver: 300 });
    const r = await embedInBatches([long], fn);
    expect(r.vectors).toEqual([[EMBED_FALLBACK_CHARS[1]]]);
    expect(r.truncated).toBe(1);
  });

  it("rethrows when a text is rejected at every length (non-length failure)", async () => {
    const { fn, calls } = fakeEmbed({ alwaysFail: true });
    await expect(embedInBatches(["a".repeat(600), "b"], fn)).rejects.toThrow("401");
    // バッチ 1 回 + 最初の文の 3 段（全文・500・250）で止まり、2 文目には進まない
    expect(calls.length).toBe(1 + 1 + EMBED_FALLBACK_CHARS.length);
  });

  it("handles an empty input", async () => {
    const { fn, calls } = fakeEmbed();
    const r = await embedInBatches([], fn);
    expect(r.vectors).toEqual([]);
    expect(calls.length).toBe(0);
  });
});
