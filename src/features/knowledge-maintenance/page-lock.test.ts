import { describe, it, expect } from "vitest";
import { withPageLock } from "./page-lock";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("withPageLock", () => {
  it("同じ wikiId は直列に走る", async () => {
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([withPageLock("w", task("a")), withPageLock("w", task("b"))]);
    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("別の wikiId は並行に走る", async () => {
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name}:start`);
      await tick();
      log.push(`${name}:end`);
    };
    await Promise.all([withPageLock("x", task("a")), withPageLock("y", task("b"))]);
    expect(log.slice(0, 2)).toEqual(["a:start", "b:start"]);
  });

  it("例外でも解放され、後続が走る。例外は呼び出し元へ伝わる", async () => {
    const p1 = withPageLock("w", async () => {
      throw new Error("boom");
    });
    const p2 = withPageLock("w", async () => "ok");
    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBe("ok");
  });

  it("戻り値を返す", async () => {
    expect(await withPageLock("w", async () => 42)).toBe(42);
  });
});
