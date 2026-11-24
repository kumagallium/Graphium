import { afterEach, describe, expect, it, vi } from "vitest";
import { drainExternalChanges, setExternalChangeDrainer } from "./external-changes";

afterEach(() => {
  setExternalChangeDrainer(null);
  vi.useRealTimers();
});

describe("external-changes", () => {
  it("登録が無ければ即座に解決する", async () => {
    await expect(drainExternalChanges()).resolves.toBeUndefined();
  });

  it("登録された drainer を実行して終わるまで待つ・解除すると呼ばない", async () => {
    let done = false;
    const fn = vi.fn(async () => {
      await Promise.resolve();
      done = true;
    });
    setExternalChangeDrainer(fn);
    await drainExternalChanges();
    expect(done).toBe(true);
    setExternalChangeDrainer(null);
    await drainExternalChanges();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("drainer の失敗は握る", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setExternalChangeDrainer(async () => { throw new Error("x"); });
    await expect(drainExternalChanges()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("タイムアウトしたら待たずに進む", async () => {
    vi.useFakeTimers();
    setExternalChangeDrainer(() => new Promise<void>(() => {}));
    let resolved = false;
    void drainExternalChanges(1500).then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1499);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(resolved).toBe(true);
  });
});

describe("sameDocumentContent", () => {
  it("キーの並びが違っても同じ内容なら true・値が違えば false・undefined のキーは無視する", async () => {
    const { sameDocumentContent } = await import("./external-changes");
    expect(sameDocumentContent({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(sameDocumentContent({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameDocumentContent({ a: 1, x: undefined }, { a: 1 })).toBe(true);
    expect(sameDocumentContent({ a: 1, modifiedAt: "1" }, { a: 1, modifiedAt: "2" })).toBe(false);
  });
});

describe("drainExternalChanges（直前の成功の再利用）", () => {
  it("成功から 1 秒以内は再実行せず、過ぎたら実行する・失敗したときは再利用しない", async () => {
    vi.useFakeTimers();
    const fn = vi.fn(async () => {});
    setExternalChangeDrainer(fn);
    await drainExternalChanges();
    await drainExternalChanges();
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);
    await drainExternalChanges();
    expect(fn).toHaveBeenCalledTimes(2);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = vi.fn(async () => { throw new Error("x"); });
    setExternalChangeDrainer(bad);
    await drainExternalChanges();
    await drainExternalChanges();
    expect(bad).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
