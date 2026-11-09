import { beforeEach, describe, expect, it } from "vitest";
import { LINT_PROGRESS_TTL_MS, clearLintProgressForTest, getLintProgress, isLintProgressId, setLintProgress } from "./lint-progress";

beforeEach(() => clearLintProgressForTest());

describe("lint-progress", () => {
  it("書いた進み具合を読める。知らない ID は undefined", () => {
    setLintProgress("a", { done: 1, total: 4 }, 1000);
    expect(getLintProgress("a", 1000)).toEqual({ done: 1, total: 4 });
    expect(getLintProgress("b", 1000)).toBeUndefined();
  });
  it("一定時間を過ぎたものは忘れる（読み出しでも、次の書き込みでも）", () => {
    setLintProgress("a", { done: 4, total: 4 }, 1000);
    expect(getLintProgress("a", 1000 + LINT_PROGRESS_TTL_MS)).toEqual({ done: 4, total: 4 });
    expect(getLintProgress("a", 1000 + LINT_PROGRESS_TTL_MS + 1)).toBeUndefined();
    setLintProgress("b", { done: 0, total: 2 }, 1000);
    setLintProgress("c", { done: 0, total: 2 }, 1000 + LINT_PROGRESS_TTL_MS + 1);
    expect(getLintProgress("b", 1000 + LINT_PROGRESS_TTL_MS + 1)).toBeUndefined();
    expect(getLintProgress("c", 1000 + LINT_PROGRESS_TTL_MS + 1)).toEqual({ done: 0, total: 2 });
  });
  it("ID は英数字・ハイフン・下線の 64 文字まで", () => {
    expect(isLintProgressId("8f1c-ab_")).toBe(true);
    expect(isLintProgressId("")).toBe(false);
    expect(isLintProgressId("a b")).toBe(false);
    expect(isLintProgressId("x".repeat(65))).toBe(false);
    expect(isLintProgressId(12)).toBe(false);
  });
});
