// 全体グラフ（俯瞰）に構造由来の量を持ち込む純関数群。
//
// - foldLeafNodes: ノート以外（外部ソース・知見・洞察・話題）を、無向に隣接する
//   「ノート（kind === "note"）の数」で判定して畳む/取り除く。
// - computeReachScores: ノートごとに、辺を無向にたどって hops 以内で届く
//   「別のノート」の数を数える（知見や外部ソースを経由してもよい）。
//
// どちらも表示 props（foldLeaves / sizeMode）の裏側として global-graph-view.tsx から使う。

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
