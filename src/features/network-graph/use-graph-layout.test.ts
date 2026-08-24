import { describe, it, expect } from "vitest";
import type cytoscape from "cytoscape";
import { applySavedPositions, seedUnplacedFlowNodes } from "./use-graph-layout";

describe("applySavedPositions（Cytoscape の要素定義に保存座標を流し込む）", () => {
  const elements = (): cytoscape.ElementDefinition[] => [
    { data: { id: "a" } },
    { data: { id: "b" } },
    { data: { id: "e1", source: "a", target: "b" } },
  ];

  it("保存が無ければ全ノードが未配置になる（エッジは数えない）", () => {
    const els = elements();
    const { unplacedIds, placedCount } = applySavedPositions(els, null);
    expect(placedCount).toBe(0);
    expect(unplacedIds).toEqual(["a", "b"]);
  });

  it("保存済みノードには座標が入り、残りが未配置として返る", () => {
    const els = elements();
    const { unplacedIds, placedCount } = applySavedPositions(els, { a: { x: 10, y: 20 } });
    expect(placedCount).toBe(1);
    expect(unplacedIds).toEqual(["b"]);
    expect(els[0].position).toEqual({ x: 10, y: 20 });
    expect(els[1].position).toBeUndefined();
  });

  it("エッジには座標を入れない", () => {
    const els = elements();
    applySavedPositions(els, { e1: { x: 1, y: 1 }, a: { x: 2, y: 2 } });
    expect(els[2].position).toBeUndefined();
  });
});

describe("seedUnplacedFlowNodes（手順フローの新ノード仮置き）", () => {
  const positions = { a: { x: 0, y: 0 }, b: { x: 100, y: 100 } };

  it("保存済みノードは動かさない", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 100, y: 100 } },
    ];
    expect(seedUnplacedFlowNodes(nodes, positions)).toEqual(nodes);
  });

  it("新しいノードは既存の並びより下に置かれる（左上に固まらない）", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 100, y: 100 } },
      { id: "new", position: { x: 0, y: 0 } },
    ];
    const out = seedUnplacedFlowNodes(nodes, positions);
    const seeded = out.find((n) => n.id === "new")!;
    expect(seeded.position.y).toBeGreaterThan(100);
  });

  it("新しいノードが複数あれば横に並べる（重ならない）", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 } },
      { id: "n1", position: { x: 0, y: 0 } },
      { id: "n2", position: { x: 0, y: 0 } },
    ];
    const out = seedUnplacedFlowNodes(nodes, { a: { x: 0, y: 0 } });
    const p1 = out.find((n) => n.id === "n1")!.position;
    const p2 = out.find((n) => n.id === "n2")!.position;
    expect(p1.x).not.toBe(p2.x);
  });

  it("保存済みが 1 つも無ければ何もしない（全体を自動配置に任せる場面）", () => {
    const nodes = [{ id: "n1", position: { x: 0, y: 0 } }];
    expect(seedUnplacedFlowNodes(nodes, {})).toEqual(nodes);
  });
});
