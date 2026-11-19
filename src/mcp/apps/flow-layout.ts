// 手順の流れ図（show_steps）の配置。DOM に依存しない純粋な関数（graph-view.ts が使う）。
//
// breadthfirst は「入口からの距離」で段を決めるので、材料・装置が手順ごとに直接つながる実データでは
// すべての手順が同じ段に積まれ、手順の順序が読めなかった（2026-11-15 実データで確認）。
// ここでは線の向きに沿った最長経路で段を決める: 材料 → 手順 → 生成物 → 次の手順 … が上から下へ並ぶ
// （アプリの工程グラフ elk-flow-layout の既定 DOWN と同じ向き）。
// 入るだけの材料・装置は、最初に使う手順のすぐ上（段 - 1）に寄せる（全部を上端に集めない）。

export type FlowLayoutNode = { id: string; kind: string };
export type FlowLayoutEdge = { source: string; target: string };

/** 各ノードの段（0 始まり）。輪があっても止まる（輪の中は打ち切った時点の段） */
export function flowRanks(nodes: FlowLayoutNode[], edges: FlowLayoutEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((n) => n.id));
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }
  const rank = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  // Kahn の順で最長経路を伸ばす。輪で残ったノードは、そこまでの段のまま
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const remaining = new Map(indeg);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of out.get(id) ?? []) {
      rank.set(next, Math.max(rank.get(next) ?? 0, (rank.get(id) ?? 0) + 1));
      const left = (remaining.get(next) ?? 0) - 1;
      remaining.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  // 入るだけのノード（材料・装置）は、使う先のいちばん上の段のすぐ上へ
  for (const n of nodes) {
    if ((indeg.get(n.id) ?? 0) > 0) continue;
    const targets = out.get(n.id) ?? [];
    if (targets.length === 0) continue;
    const first = Math.min(...targets.map((t) => rank.get(t) ?? 0));
    rank.set(n.id, Math.max(0, first - 1));
  }
  return rank;
}

/** 段から座標を作る（段は上から下、段の中は元の並び順で左から右へ、中央そろえ） */
export function flowPositions(
  nodes: FlowLayoutNode[],
  edges: FlowLayoutEdge[],
  spacing: { x: number; y: number } = { x: 196, y: 84 },
): Map<string, { x: number; y: number }> {
  const rank = flowRanks(nodes, edges);
  const byRank = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) ?? 0;
    byRank.set(r, [...(byRank.get(r) ?? []), n.id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [r, list] of byRank) {
    list.forEach((id, i) => pos.set(id, { x: (i - (list.length - 1) / 2) * spacing.x, y: r * spacing.y }));
  }
  return pos;
}
