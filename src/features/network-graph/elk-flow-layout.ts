// React Flow（手順フロービュー）用の ELK layered レイアウト。
// cy-graph.ts の applyElkLayout と同じ設定値だが、Cytoscape ではなく
// 「実測サイズ付きノード → 座標 Map」の純関数として提供する。

import ELK from "elkjs/lib/elk.bundled.js";

export type ElkLayoutNode = { id: string; width: number; height: number };
export type ElkLayoutEdge = { id: string; source: string; target: string };

export async function layoutStepFlow(
  nodes: ElkLayoutNode[],
  edges: ElkLayoutEdge[],
): Promise<Map<string, { x: number; y: number }>> {
  const elk = new ELK();
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
    },
    children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });

  const positions = new Map<string, { x: number; y: number }>();
  for (const child of graph.children ?? []) {
    if (child.x != null && child.y != null) {
      positions.set(child.id, { x: child.x, y: child.y });
    }
  }
  return positions;
}
