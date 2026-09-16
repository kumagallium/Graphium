// ──────────────────────────────────────────────
// 予定の線（planned）の始点を決める。
//
// 工程フローでは実行の線がアウトプット起点で描かれる（used: アウトプット → 工程）。
// 予定の線だけ工程のポートからしか引けないと、同じグラフの中で掴める所が食い違う。
// そこでアウトプットのポートから引かれたときは、その出力を生成した工程まで遡って
// 「工程 → 工程」の予定として扱う。
//
// 遡りは `generates` エッジ（工程 → アウトプット）を辿る。ノード ID の作り方
// （plan-flow.ts の `note:<owner>#<id>`）には依存しない — ID の規則が変わっても
// ここは壊れない。
//
// 予定はノート（工程）の粒度で表の「入力元」列に保存するので、どの出力を渡すつもり
// だったかは持たない。出力単位で残したいなら列の書式から変える話になる。
// ──────────────────────────────────────────────

import type { FlowEdge } from "./activity-graph-adapter";

/**
 * 予定の線の始点に使う工程 ID。
 *
 * @param edges グラフのエッジ（`generates` を辿る）
 * @param sourceId ドラッグの始点ノード ID
 * @param sourceEntity 始点がアウトプットならその entity（工程から引いたときは undefined）
 * @returns 工程 ID。生成元まで遡れないアウトプット（計画の外で作られた等）は null
 */
export function plannedSourceId(
  edges: readonly FlowEdge[],
  sourceId: string,
  sourceEntity: { id: string } | undefined,
): string | null {
  if (!sourceEntity) return sourceId;
  const producer = edges.find(
    (e) => e.kind === "generates" && e.target === sourceEntity.id,
  )?.source;
  return producer ?? null;
}
