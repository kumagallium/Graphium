import { describe, expect, it, beforeEach } from "vitest";
import { __resetRunsForTest, getRun, isRunning, startRun } from "./runs";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("startRun", () => {
  beforeEach(() => __resetRunsForTest());

  it("同じ録音・種類は 1 本だけ。別の録音・別の種類は並べて走れる", async () => {
    let done!: () => void;
    const work = () => new Promise<{ value: string }>((r) => (done = () => r({ value: "ok" })));
    expect(startRun("f1", "cleanup", work, String)).toBe(true);
    expect(startRun("f1", "cleanup", work, String)).toBe(false);
    expect(startRun("f2", "cleanup", async () => ({ value: "x" }), String)).toBe(true);
    expect(startRun("f1", "summary", async () => ({ value: "y" }), String)).toBe(true);
    done();
    await tick();
    expect(isRunning("f1", "cleanup")).toBe(false);
    expect(getRun("f1", "cleanup").result).toEqual({ value: "ok" });
  });

  it("進み具合・失敗の文・保存できなかった知らせを残し、次の実行で失敗の文を消す", async () => {
    startRun(
      "f1",
      "cleanup",
      async (onProgress) => {
        onProgress(2, 5);
        expect(getRun("f1", "cleanup").progress).toEqual({ done: 2, total: 5 });
        throw new Error("boom");
      },
      (e) => `failed: ${(e as Error).message}`,
    );
    await tick();
    expect(getRun("f1", "cleanup")).toMatchObject({ progress: null, error: "failed: boom" });
    startRun("f1", "cleanup", async () => ({ value: 1, warning: "not saved" }), String);
    expect(getRun("f1", "cleanup").error).toBeNull();
    await tick();
    expect(getRun("f1", "cleanup")).toMatchObject({ error: "not saved", result: { value: 1 } });
  });
});
