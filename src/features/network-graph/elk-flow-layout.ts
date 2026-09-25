// React Flow（手順フロービュー）用の ELK layered レイアウト。
// cy-graph.ts の applyElkLayout と同じ設定値だが、Cytoscape ではなく
// 「実測サイズ付きノード → 座標 Map」の純関数として提供する。

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode } from "elkjs/lib/elk-api";

export type ElkLayoutNode = {
  id: string;
  /**
   * 帯（表ごとのグループ）ノード自身は width/height を渡さない（ELK が子から
   * 決める）。その他のノードは実測サイズを渡す。
   */
  width?: number;
  height?: number;
  /**
   * 帯（表ごとのグループ）ノードの id。付いていると ELK の compound layout で
   * その親ノードの子として並べる（子の座標は親からの相対、ELK の出力どおり
   * ＝ React Flow の parentId 付きノードの座標系と同じ）。
   */
  parentId?: string;
};
export type ElkLayoutEdge = { id: string; source: string; target: string };

/** レイアウト後の位置。親ノード（帯）は ELK が決めた width/height も一緒に返す */
export type ElkLayoutPosition = { x: number; y: number; width?: number; height?: number };

export async function layoutStepFlow(
  nodes: ElkLayoutNode[],
  edges: ElkLayoutEdge[],
  opts?: { direction?: "DOWN" | "RIGHT" },
): Promise<Map<string, ElkLayoutPosition>> {
  const elk = new ELK();

  // parentId を持つノードは、対応する親（帯）ノードの children に入れて ELK に渡す。
  // 親ノードは width/height を渡さない（ELK が子から決める）
  const childrenByParent = new Map<string, ElkLayoutNode[]>();
  const rootNodes: ElkLayoutNode[] = [];
  for (const n of nodes) {
    if (n.parentId) {
      const list = childrenByParent.get(n.parentId) ?? [];
      list.push(n);
      childrenByParent.set(n.parentId, list);
    } else {
      rootNodes.push(n);
    }
  }

  const toElkChild = (n: ElkLayoutNode): ElkNode => {
    const children = childrenByParent.get(n.id);
    if (children) {
      // 帯ノード自身: サイズは渡さず、子から ELK に決めさせる
      return {
        id: n.id,
        layoutOptions: { "elk.padding": "[top=40,left=16,bottom=16,right=16]" },
        children: children.map((c) => ({ id: c.id, width: c.width, height: c.height })),
      };
    }
    return { id: n.id, width: n.width, height: n.height };
  };

  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": opts?.direction ?? "DOWN",
      "elk.spacing.nodeNode": "32",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      // 帯をまたぐ線を root のエッジのまま扱う（子の compound に付け替えない）
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
    },
    children: rootNodes.map(toElkChild),
    edges: edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });

  const positions = new Map<string, ElkLayoutPosition>();
  const visit = (node: ElkNode) => {
    if (node.x != null && node.y != null) {
      positions.set(node.id, { x: node.x, y: node.y, width: node.width, height: node.height });
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const child of graph.children ?? []) visit(child);
  return positions;
}
