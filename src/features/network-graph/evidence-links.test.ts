import { describe, expect, it } from "vitest";
import { evidenceRelays, isEvidenceLink } from "./evidence-links";

// 知見 a1・a2・a3 が出典 S にだけつながり、知見 b1 は出典 T に、T は c1 にもつながる
const adj: Record<string, string[]> = {
  S: ["a1", "a2", "a3"],
  a1: ["S"],
  a2: ["S"],
  a3: ["S"],
  T: ["b1", "c1"],
  b1: ["T"],
  c1: ["T"],
};
const nb = (id: string) => adj[id] ?? [];

describe("evidenceRelays", () => {
  it("触れたページ 2 つ以上とつながる触れていないページを中継にする", () => {
    const touched = new Set(["a1", "a2", "b1"]);
    expect([...evidenceRelays(Object.keys(adj), nb, (id) => touched.has(id))]).toEqual(["S"]);
  });

  it("触れたページ 1 つとしかつながらないページは中継にしない", () => {
    const touched = new Set(["a1", "b1"]);
    expect(evidenceRelays(Object.keys(adj), nb, (id) => touched.has(id)).size).toBe(0);
  });

  it("触れたページ自身は中継にしない", () => {
    const touched = new Set(["S", "a1", "a2"]);
    expect(evidenceRelays(Object.keys(adj), nb, (id) => touched.has(id)).has("S")).toBe(false);
  });
});

describe("isEvidenceLink", () => {
  const touched = new Set(["a1", "a2", "x"]);
  const isT = (id: string) => touched.has(id);
  const relays = new Set(["S", "R"]);

  it("触れたページ同士の線は引く", () => {
    expect(isEvidenceLink("a1", "x", isT, relays)).toBe(true);
  });
  it("触れたページと中継の線は向きを問わず引く", () => {
    expect(isEvidenceLink("a1", "S", isT, relays)).toBe(true);
    expect(isEvidenceLink("S", "a2", isT, relays)).toBe(true);
  });
  it("中継どうし・中継と触れていないページの線は引かない", () => {
    expect(isEvidenceLink("S", "R", isT, relays)).toBe(false);
    expect(isEvidenceLink("S", "a3", isT, relays)).toBe(false);
  });
});
