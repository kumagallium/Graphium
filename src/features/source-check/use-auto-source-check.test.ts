// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { pickNextUncheckedSource, useAutoSourceCheck } from "./use-auto-source-check";
import type { WikiMetaSummary } from "../../lib/document-types";

function meta(over: Partial<WikiMetaSummary>): WikiMetaSummary {
  return { title: "t", kind: "claim", ...over };
}

describe("pickNextUncheckedSource", () => {
  it("未照合（sourceCheckVerdict なし）の claim/topic を返す", () => {
    const m = new Map<string, WikiMetaSummary>([["a", meta({ kind: "claim" })]]);
    expect(pickNextUncheckedSource(m)).toBe("a");
  });

  it("既に sourceCheckVerdict があるものはスキップする（無限再照合を防ぐ）", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h" } })],
      ["b", meta({ kind: "topic" })],
    ]);
    expect(pickNextUncheckedSource(m)).toBe("b");
  });

  it("dismissed 済みの sourceCheckVerdict もスキップする（結果が無いわけではない）", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "claim", sourceCheckVerdict: { verdict: "unclear", dismissed: true, claimHash: "h" } })],
    ]);
    expect(pickNextUncheckedSource(m)).toBeNull();
  });

  it("claim / topic 以外（summary/atom/synthesis）は対象外", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["s", meta({ kind: "summary" })],
      ["a", meta({ kind: "atom" })],
      ["y", meta({ kind: "synthesis" })],
    ]);
    expect(pickNextUncheckedSource(m)).toBeNull();
  });

  it("対象が無ければ null", () => {
    expect(pickNextUncheckedSource(new Map())).toBeNull();
  });

  it("挿入順で最初の未照合を返す", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "claim", sourceCheckVerdict: { verdict: "supported", claimHash: "h" } })],
      ["b", meta({ kind: "topic" })],
      ["c", meta({ kind: "claim" })],
    ]);
    expect(pickNextUncheckedSource(m)).toBe("b");
  });

  it("skip 集合（ハード失敗した id）に含まれる id はスキップする（ホットループ防止）", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "claim" })],
      ["b", meta({ kind: "topic" })],
    ]);
    expect(pickNextUncheckedSource(m, new Set(["a"]))).toBe("b");
    expect(pickNextUncheckedSource(m, new Set(["a", "b"]))).toBeNull();
  });
});

describe("useAutoSourceCheck", () => {
  it("busy（手動 1 件・一括実行中）のときは新規に照合を開始しない", () => {
    vi.useFakeTimers();
    try {
      const checkOne = vi.fn().mockResolvedValue(undefined);
      const wikiMetas = new Map<string, WikiMetaSummary>([["a", meta({ kind: "claim" })]]);
      renderHook(() => useAutoSourceCheck({ enabled: true, wikiMetas, busy: true, checkOne }));
      vi.advanceTimersByTime(5000);
      expect(checkOne).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("enabled かつ busy でなければデバウンス後に未照合の 1 件を照合する", () => {
    vi.useFakeTimers();
    try {
      const checkOne = vi.fn().mockResolvedValue(undefined);
      const wikiMetas = new Map<string, WikiMetaSummary>([["a", meta({ kind: "claim" })]]);
      renderHook(() => useAutoSourceCheck({ enabled: true, wikiMetas, busy: false, checkOne, debounceMs: 1000 }));
      vi.advanceTimersByTime(999);
      expect(checkOne).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(checkOne).toHaveBeenCalledWith("a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("enabled が false なら何もしない", () => {
    vi.useFakeTimers();
    try {
      const checkOne = vi.fn().mockResolvedValue(undefined);
      const wikiMetas = new Map<string, WikiMetaSummary>([["a", meta({ kind: "claim" })]]);
      renderHook(() => useAutoSourceCheck({ enabled: false, wikiMetas, busy: false, checkOne }));
      vi.advanceTimersByTime(5000);
      expect(checkOne).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
