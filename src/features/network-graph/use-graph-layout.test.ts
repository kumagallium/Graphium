import { describe, it, expect, vi } from "vitest";
import type cytoscape from "cytoscape";
import {
  applySavedPositions,
  attachCytoscapeLayoutPersistence,
  seedUnplacedFlowNodes,
  stopLayoutOnGrab,
} from "./use-graph-layout";

describe("attachCytoscapeLayoutPersistence（何を保存し、何を伝えるか）", () => {
  function fakeCyWithNodes(nodes: Array<{ id: string; selected: boolean; cluster?: boolean }>) {
    const handlers = new Map<string, () => void>();
    const list = nodes.map((n) => ({
      id: () => n.id,
      position: () => ({ x: 1, y: 2 }),
      hasClass: (c: string) => c === "cluster-hub" && !!n.cluster,
      selected: n.selected,
    }));
    return {
      on: (event: string, _sel: string, handler: () => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
      // 配列をそのまま返す（forEach / length はそれで足りる）
      nodes: (selector?: string) =>
        selector === ":selected" ? list.filter((n) => n.selected) : list,
      fire: (event: string) => handlers.get(event)?.(),
    };
  }

  it("1 つだけ動かしたときは「まとめて動かした」と伝えない", () => {
    const cy = fakeCyWithNodes([
      { id: "a", selected: true },
      { id: "b", selected: false },
    ]);
    const save = vi.fn();
    attachCytoscapeLayoutPersistence(cy as never, save);
    cy.fire("dragfree");
    expect(save).toHaveBeenCalledWith(expect.anything(), false);
  });

  it("複数選択して動かしたときは「まとめて動かした」と伝える（ヒントの役目が終わる合図）", () => {
    const cy = fakeCyWithNodes([
      { id: "a", selected: true },
      { id: "b", selected: true },
    ]);
    const save = vi.fn();
    attachCytoscapeLayoutPersistence(cy as never, save);
    cy.fire("dragfree");
    expect(save).toHaveBeenCalledWith(expect.anything(), true);
  });

  it("不可視のダミーノード（cluster-hub）は保存しない", () => {
    const cy = fakeCyWithNodes([
      { id: "a", selected: false },
      { id: "hub", selected: false, cluster: true },
    ]);
    const save = vi.fn();
    attachCytoscapeLayoutPersistence(cy as never, save);
    cy.fire("dragfree");
    expect(Object.keys(save.mock.calls[0][0])).toEqual(["a"]);
  });
});

describe("stopLayoutOnGrab（ドラッグで自動レイアウトに引き下がってもらう）", () => {
  /** on/off とハンドラ発火だけを持つ最小の Cytoscape 代役 */
  function fakeCy() {
    const handlers = new Map<string, () => void>();
    return {
      on: (event: string, _selector: string, handler: () => void) => {
        handlers.set(event, handler);
      },
      off: (event: string) => {
        handlers.delete(event);
      },
      fire: (event: string) => handlers.get(event)?.(),
      has: (event: string) => handlers.has(event),
    };
  }

  it("ノードが動いたら走っているレイアウトを止める", () => {
    const cy = fakeCy();
    const layout = { stop: vi.fn() };
    stopLayoutOnGrab(cy as unknown as cytoscape.Core, layout);
    cy.fire("drag");
    expect(layout.stop).toHaveBeenCalledTimes(1);
  });

  it("掴んだだけ（クリック）では止めない — ナビゲーションのクリックで並びが固まらないように", () => {
    const cy = fakeCy();
    const layout = { stop: vi.fn() };
    stopLayoutOnGrab(cy as unknown as cytoscape.Core, layout);
    expect(cy.has("grab")).toBe(false);
    cy.fire("grab");
    expect(layout.stop).not.toHaveBeenCalled();
  });

  it("ドラッグ中に何度発火しても止めるのは一度だけ", () => {
    const cy = fakeCy();
    const layout = { stop: vi.fn() };
    stopLayoutOnGrab(cy as unknown as cytoscape.Core, layout);
    cy.fire("drag");
    cy.fire("drag");
    cy.fire("drag");
    expect(layout.stop).toHaveBeenCalledTimes(1);
  });

  it("解除するとハンドラが外れる", () => {
    const cy = fakeCy();
    const layout = { stop: vi.fn() };
    const detach = stopLayoutOnGrab(cy as unknown as cytoscape.Core, layout);
    detach();
    cy.fire("drag");
    expect(layout.stop).not.toHaveBeenCalled();
  });
});

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
