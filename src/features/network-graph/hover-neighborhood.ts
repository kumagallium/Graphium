import type cytoscape from "cytoscape";

/**
 * ホバーで強調する「本物の 1 ホップ」。
 *
 * `node.neighborhood()` は島配置のために張った不可視の辺（話題どうしの射影・重心
 * ダミーへの辺。`cluster-edge` / data.virtual / data.projection）も辿るので、話題に
 * ホバーすると同じ資料を引く話題が全部光り、2 ホップ先まで強調されたように見えた。
 * ここでは見える本物の関係（派生・素材利用・参照）と、畳んだ葉の線（衛星）だけを辿る。
 */
export function visibleNeighborhood(node: cytoscape.NodeSingular): cytoscape.CollectionReturnValue {
  const edges = node
    .connectedEdges()
    .filter((e) => !e.hasClass("cluster-edge") && !e.data("virtual") && !e.data("projection"));
  return edges.union(edges.connectedNodes().difference(node));
}
