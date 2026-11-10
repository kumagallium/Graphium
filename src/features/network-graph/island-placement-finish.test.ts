import { describe, it, expect } from "vitest";
import cytoscape from "cytoscape";
import { finishIslandPlacement } from "./global-graph-view";
import type { NoteEdge, NoteNode } from "./graph-builder";

// 組み直しのたびに「島の下に並べるノード」が下へ離れていった不具合（2026-11-10）の再発防止。
// 親ノートが島の下に回るとき、その衛星は前回の位置（前回の島の下）に残っている。
// それを置き済みとして並べ場所の箱に入れると、並べ場所が前回よりさらに下になる。

const node = (id: string) => ({ id }) as unknown as NoteNode;

function setup() {
  const cy = cytoscape({
    headless: true,
    elements: [
      // 島（置き済み）: 原点のまわり
      { data: { id: "topic", size: 30 }, position: { x: 0, y: 0 } },
      { data: { id: "claim", size: 14 }, position: { x: 40, y: 0 } },
      // 話題の届かないノートと、その衛星。どちらも前回の島の下（y=5000）に残っている
      { data: { id: "note", size: 14 }, position: { x: 0, y: 5000 } },
      { data: { id: "sat", size: 9 }, position: { x: 20, y: 5000 } },
      { data: { id: "e1", source: "topic", target: "claim" } },
    ],
  });
  return cy;
}

describe("finishIslandPlacement", () => {
  it("親が島の下に回る衛星の古い位置で、島の下の並べ場所が下へずれない", () => {
    const cy = setup();
    finishIslandPlacement(cy, {
      shownNodes: [node("topic"), node("claim"), node("note")],
      shownEdges: [{ source: "topic", target: "claim" }] as unknown as NoteEdge[],
      foldedOutNodes: [node("sat")],
      foldedInto: new Map([["sat", "note"]]),
      positionedIds: new Set(["topic", "claim"]),
    });
    const notePos = cy.getElementById("note").position();
    const satPos = cy.getElementById("sat").position();
    // 島のすぐ下（箱の下端 + 160 前後）に並ぶ。前回の位置（5000）に引きずられない
    expect(notePos.y).toBeLessThan(500);
    // 衛星は親の新しい位置のまわりに置き直される
    expect(Math.hypot(satPos.x - notePos.x, satPos.y - notePos.y)).toBeLessThan(60);
  });

  it("親が置き済みの衛星は置き済みとして扱い、動かさない", () => {
    const cy = setup();
    cy.getElementById("sat").position({ x: 60, y: 10 });
    finishIslandPlacement(cy, {
      shownNodes: [node("topic"), node("claim")],
      shownEdges: [{ source: "topic", target: "claim" }] as unknown as NoteEdge[],
      foldedOutNodes: [node("sat")],
      foldedInto: new Map([["sat", "topic"]]),
      positionedIds: new Set(["topic", "claim"]),
    });
    const satPos = cy.getElementById("sat").position();
    expect(Math.hypot(satPos.x - 60, satPos.y - 10)).toBeLessThan(30);
  });
});
