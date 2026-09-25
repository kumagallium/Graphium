// 全体グラフ（俯瞰）に構造由来の量を持ち込む純関数群。
//
// - foldLeafNodes: ノート以外（外部ソース・知見・洞察・話題）を、無向に隣接する
//   「ノート（kind === "note"）の数」で判定して畳む/取り除く。
// - computeReachScores: ノートごとに、辺を無向にたどって hops 以内で届く
//   「別のノート」の数を数える（知見や外部ソースを経由してもよい）。
// - assignIslands: reach の高いノート（ハブ）を選び、他のノートを最も近いハブに
//   割り当てる（layoutMode: islands の裏側。clusterByContext の「タグごとの
//   重心」と同じ仕組みをハブ割り当てで作るための下ごしらえ）。
//
// どちらも表示 props（foldLeaves / sizeMode / layoutMode）の裏側として
// global-graph-view.tsx から使う。

import type { NoteGraphData, NoteNode } from "./graph-builder";
import { kindOf } from "./graph-kind";

/**
 * ノート以外（external / wiki: claim・atom・synthesis・topic）のノードを、
 * 無向に隣接する「ノート（kind === "note"）の数」で判定する:
 *   - ちょうど 1 : その 1 つのノートに畳む（+n）。知見同士・話題との辺も一緒に消える
 *   - 0         : ノートに繋がっていない（話題や、知見にしか繋がっていない知見など）。
 *                 取り除くが特定の相手へは畳まない（foldedTotal にだけ数える）
 *   - 2 以上     : ノートをまたぐ橋なので骨格の一部として残す
 * すべて元データの隣接関係だけで 1 回の走査で決める（畳んだ結果を使って再判定しない
 * ＝連鎖させない）。
 */
export function foldLeafNodes(data: NoteGraphData): {
  data: NoteGraphData;
  foldedCount: Map<string, number>;
  foldedTotal: number;
} {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const neighborIds = new Map<string, string[]>();
  for (const n of data.nodes) neighborIds.set(n.id, []);
  for (const e of data.edges) {
    neighborIds.get(e.source)?.push(e.target);
    neighborIds.get(e.target)?.push(e.source);
  }

  const removeIds = new Set<string>();
  const foldedCount = new Map<string, number>();
  let foldedTotal = 0;

  for (const n of data.nodes) {
    if (kindOf(n) === "note") continue;
    const noteNeighbors = new Set<string>();
    for (const nbId of neighborIds.get(n.id) ?? []) {
      const nb = nodeById.get(nbId);
      if (nb && kindOf(nb) === "note") noteNeighbors.add(nbId);
    }
    if (noteNeighbors.size === 1) {
      const targetId = [...noteNeighbors][0];
      removeIds.add(n.id);
      foldedCount.set(targetId, (foldedCount.get(targetId) ?? 0) + 1);
      foldedTotal++;
    } else if (noteNeighbors.size === 0) {
      removeIds.add(n.id);
      foldedTotal++;
    }
    // 2 以上はノートをまたぐ橋として残す（何もしない）
  }

  const nodes = data.nodes.filter((n) => !removeIds.has(n.id));
  const edges = data.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target));
  return { data: { nodes, edges }, foldedCount, foldedTotal };
}

/**
 * ノートごとに、辺を無向に hops（既定 2）ホップ以内でたどって届く
 * 別のノート（kind === "note"）の数を返す。ノート以外の id は Map に入れない。
 * 各ノートから素直に BFS を回す（ノート数百 × 辺数千なら十分速い）。
 */
export function computeReachScores(
  data: NoteGraphData,
  opts?: { hops?: number },
): Map<string, number> {
  const hops = opts?.hops ?? 2;
  const adjacency = new Map<string, string[]>();
  const addEdge = (a: string, b: string) => {
    const list = adjacency.get(a);
    if (list) list.push(b);
    else adjacency.set(a, [b]);
  };
  for (const n of data.nodes) if (!adjacency.has(n.id)) adjacency.set(n.id, []);
  for (const e of data.edges) {
    addEdge(e.source, e.target);
    addEdge(e.target, e.source);
  }

  const noteIds = new Set(data.nodes.filter((n) => kindOf(n) === "note").map((n) => n.id));
  const scores = new Map<string, number>();

  for (const startId of noteIds) {
    const visited = new Map<string, number>([[startId, 0]]);
    let frontier = [startId];
    for (let depth = 1; depth <= hops && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adjacency.get(id) ?? []) {
          if (visited.has(nb)) continue;
          visited.set(nb, depth);
          next.push(nb);
        }
      }
      frontier = next;
    }
    let score = 0;
    for (const [id, depth] of visited) {
      if (depth === 0) continue;
      if (depth > hops) continue;
      if (noteIds.has(id)) score++;
    }
    scores.set(startId, score);
  }
  return scores;
}

/**
 * reach（computeReachScores の結果）が高いノートを「ハブ」に選び、他のノートを
 * 最も近いハブに割り当てる（layoutMode: islands の裏側）。
 *
 * - ハブ候補: reach が maxReach（表示中の最大値）の 60% 以上のノート。候補が 0
 *   件なら reach 上位 3 件にフォールバックする。
 * - 候補同士が無向で 2 ホップ以内に隣接していれば、reach の高い方だけ残す
 *   （近すぎるハブを間引く。reach 降順で貪欲に選ぶ）。
 * - 残ったハブから無向 BFS を 3 ホップ（既定）まで伸ばし、各ノート（kind===
 *   "note" のみ。ハブ以外は対象外）を最も近いハブに割り当てる。同距離なら
 *   reach の高いハブを選ぶ。ハブ自身は自分に割り当てる。届かないノートは
 *   戻り値の Map に入らない。
 */
export function assignIslands(
  data: NoteGraphData,
  reachScores: Map<string, number>,
  opts?: { maxHops?: number },
): Map<string, string> {
  const maxHops = opts?.maxHops ?? 3;
  const noteIds = data.nodes.filter((n) => kindOf(n) === "note").map((n) => n.id);
  const assignment = new Map<string, string>();
  if (noteIds.length === 0) return assignment;

  const adjacency = new Map<string, string[]>();
  for (const n of data.nodes) adjacency.set(n.id, []);
  for (const e of data.edges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }

  let maxReach = 0;
  for (const v of reachScores.values()) if (v > maxReach) maxReach = v;

  const reachOf = (id: string) => reachScores.get(id) ?? 0;
  const threshold = maxReach * 0.6;
  let candidateIds = noteIds.filter((id) => reachOf(id) >= threshold);
  if (candidateIds.length === 0) {
    candidateIds = [...noteIds].sort((a, b) => reachOf(b) - reachOf(a)).slice(0, 3);
  }

  const withinHops = (start: string, hops: number): Set<string> => {
    const visited = new Set<string>([start]);
    let frontier = [start];
    for (let d = 1; d <= hops && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adjacency.get(id) ?? []) {
          if (!visited.has(nb)) {
            visited.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    return visited;
  };

  // 近すぎる候補は reach の高い方だけ残す（reach 降順で貪欲に選ぶ）
  const sortedCandidates = [...candidateIds].sort((a, b) => reachOf(b) - reachOf(a));
  const hubs: string[] = [];
  for (const id of sortedCandidates) {
    const near = withinHops(id, 2);
    if (hubs.some((h) => near.has(h))) continue;
    hubs.push(id);
  }

  // 各ハブから maxHops 以内の距離を求める
  const distanceByHub = new Map<string, Map<string, number>>();
  for (const hub of hubs) {
    const dist = new Map<string, number>([[hub, 0]]);
    let frontier = [hub];
    for (let d = 1; d <= maxHops && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of adjacency.get(id) ?? []) {
          if (!dist.has(nb)) {
            dist.set(nb, d);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    distanceByHub.set(hub, dist);
  }

  for (const noteId of noteIds) {
    let bestHub: string | null = null;
    let bestDist = Infinity;
    for (const hub of hubs) {
      const d = distanceByHub.get(hub)?.get(noteId);
      if (d === undefined) continue;
      if (d < bestDist || (d === bestDist && bestHub !== null && reachOf(hub) > reachOf(bestHub))) {
        bestDist = d;
        bestHub = hub;
      }
    }
    if (bestHub !== null) assignment.set(noteId, bestHub);
  }
  return assignment;
}

/**
 * ラベル伝播法（Label Propagation Algorithm）でコミュニティを検出する。
 * ノート以外も含む全ノードが対象。
 *
 * 全ノードに自分の id をラベルとして与え、ノード id の**昇順**で走査して、
 * 隣接ノードの現在のラベル（同じ 1 回の走査の中で既に更新されたものも含む——
 * 非同期更新）のうち最多のものに置き換える。同数なら文字列順で小さい方。
 * これを `iterations`（既定 20）回か、1 回の走査で誰も変わらなくなるまで繰り返す。
 * 乱数は使わない（決定的）。孤立ノード（隣接無し）は自分のラベルのまま。
 */
export function detectCommunities(
  data: NoteGraphData,
  opts?: { iterations?: number },
): Map<string, string> {
  const maxIterations = opts?.iterations ?? 20;
  const ids = data.nodes.map((n) => n.id).sort();
  const adjacency = new Map<string, string[]>();
  for (const n of data.nodes) adjacency.set(n.id, []);
  for (const e of data.edges) {
    adjacency.get(e.source)?.push(e.target);
    adjacency.get(e.target)?.push(e.source);
  }

  const label = new Map<string, string>();
  for (const id of ids) label.set(id, id);

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const id of ids) {
      const neighbors = adjacency.get(id) ?? [];
      if (neighbors.length === 0) continue;
      const counts = new Map<string, number>();
      for (const nb of neighbors) {
        const l = label.get(nb)!;
        counts.set(l, (counts.get(l) ?? 0) + 1);
      }
      // 文字列順（昇順）に見て、最初に最多数を更新したラベルを採用する
      // → 同数のときは文字列順で小さい方が自然に残る
      let bestLabel: string | null = null;
      let bestCount = -1;
      for (const l of [...counts.keys()].sort()) {
        const c = counts.get(l)!;
        if (c > bestCount) {
          bestCount = c;
          bestLabel = l;
        }
      }
      if (bestLabel !== null && bestLabel !== label.get(id)) {
        label.set(id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return label;
}
