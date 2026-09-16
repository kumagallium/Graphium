import { describe, expect, it } from "vitest";
import { shouldShowLintBadge, type LintBadgeSummary } from "./wiki-lint-badge";

describe("shouldShowLintBadge", () => {
  const summary = (overrides: Partial<LintBadgeSummary> = {}): LintBadgeSummary => ({
    lastLintAt: "2026-09-10T00:00:00.000Z",
    needsAttentionCount: 2,
    hasError: false,
    ...overrides,
  });

  it("要約が無ければ出さない", () => {
    expect(shouldShowLintBadge(null, null)).toBe(false);
  });

  it("件数が 0 なら出さない（段階的開示）", () => {
    expect(shouldShowLintBadge(summary({ needsAttentionCount: 0 }), null)).toBe(false);
  });

  it("一度も開いていなければ出す", () => {
    expect(shouldShowLintBadge(summary(), null)).toBe(true);
  });

  it("開いた後に新しい点検が走っていなければ出さない", () => {
    const s = summary({ lastLintAt: "2026-09-10T00:00:00.000Z" });
    expect(shouldShowLintBadge(s, "2026-09-11T00:00:00.000Z")).toBe(false);
  });

  it("開いた後に新しく点検が走っていれば出す", () => {
    const s = summary({ lastLintAt: "2026-09-12T00:00:00.000Z" });
    expect(shouldShowLintBadge(s, "2026-09-11T00:00:00.000Z")).toBe(true);
  });

  it("時刻が壊れていれば安全側（出す）に倒す", () => {
    const s = summary({ lastLintAt: "not-a-date" });
    expect(shouldShowLintBadge(s, "2026-09-11T00:00:00.000Z")).toBe(true);
  });
});
