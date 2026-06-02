import { describe, expect, it } from "vitest";

import { pickNextUngrounded } from "./use-auto-grounding";
import type { WikiMetaSummary } from "../lib/document-types";

function meta(over: Partial<WikiMetaSummary>): WikiMetaSummary {
  return { title: "t", kind: "atom", ...over };
}

describe("pickNextUngrounded", () => {
  it("未照合（checkedAt なし）の atom/claim を返す", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "atom" })],
    ]);
    expect(pickNextUngrounded(m)).toBe("a");
  });

  it("既に checkedAt があるものはスキップする（無限再照合を防ぐ）", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "atom", groundingValidity: { checkedAt: "2026-06-02T00:00:00Z" } })],
      ["b", meta({ kind: "claim" })],
    ]);
    expect(pickNextUngrounded(m)).toBe("b");
  });

  it("マッチなし照合（verdict 無し + checkedAt あり）も照合済み扱いでスキップ", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "claim", groundingValidity: { checkedAt: "2026-06-02T00:00:00Z" } })],
    ]);
    expect(pickNextUngrounded(m)).toBeNull();
  });

  it("summary / synthesis は対象外", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["s", meta({ kind: "summary" })],
      ["y", meta({ kind: "synthesis" })],
    ]);
    expect(pickNextUngrounded(m)).toBeNull();
  });

  it("対象が無ければ null", () => {
    expect(pickNextUngrounded(new Map())).toBeNull();
  });

  it("挿入順で最初の未照合を返す", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "atom", groundingValidity: { checkedAt: "x" } })],
      ["b", meta({ kind: "atom" })],
      ["c", meta({ kind: "claim" })],
    ]);
    expect(pickNextUngrounded(m)).toBe("b");
  });

  it("skip 集合（ハード失敗した id）に含まれる id はスキップする（ホットループ防止）", () => {
    const m = new Map<string, WikiMetaSummary>([
      ["a", meta({ kind: "atom" })],
      ["b", meta({ kind: "claim" })],
    ]);
    expect(pickNextUngrounded(m, new Set(["a"]))).toBe("b");
    expect(pickNextUngrounded(m, new Set(["a", "b"]))).toBeNull();
  });
});
