// 全体グラフ（俯瞰）に構造由来の量を持ち込む純関数群。
//
// - FocusLayer / isFocused: 「島」を何を中心に作るか（ノート / 知見・洞察・話題
//   / 外部ソース）。foldLeafNodes・computeReachScores・detectFocusCommunities が
//   共通で使う。
// - foldLeafNodes: フォーカス種類以外を、無向に隣接する「フォーカス種類の数」で
//   判定して畳む/取り除く（既定 focus は "note"）。
// - computeReachScores: フォーカス種類のノードごとに、辺を無向にたどって hops
//   以内で届く「別のフォーカスノード」の数を数える（既定 focus は "note"）。
// - assignIslands: reach の高いノート（ハブ）を選び、他のノートを最も近いハブに
//   割り当てる（layoutMode: islands 初期版の裏側。現在は使っていないがテストは
//   残す。clusterByContext の「タグごとの重心」と同じ仕組みをハブ割り当てで
//   作るための下ごしらえだった）。
// - detectCommunities: ラベル伝播法で全ノード込みのコミュニティを検出する。
// - detectFocusCommunities: detectCommunities をフォーカス種類限定（射影グラフ）
//   で走らせ、フォーカス以外は隣接フォーカスノードの多数派に所属させる
//   （layoutMode: islands の裏側）。detectNoteCommunities はその focus="note" 版。
//
// 表示 props（foldLeaves / sizeMode / layoutMode / focusLayer）の裏側として
// global-graph-view.tsx から使う。

import type { NoteGraphData, NoteNode } from "./graph-builder";
import { kindOf } from "./graph-kind";

/**
 * 全体グラフ（俯瞰）の「島」を何を中心に作るか。
 *   - note    : ノート（既定。今までの動作）
 *   - crystal : 知見・洞察・話題（claim / atom / topic）
 *   - source  : 外部ソース（external）
 */
export type FocusLayer = "note" | "crystal" | "source";

/** ノードが focus の種類に属するかを判定する。 */
export function isFocused(node: NoteNode, focus: FocusLayer): boolean {
  const kind = kindOf(node);
  if (focus === "note") return kind === "note";
  if (focus === "source") return kind === "external";
  return kind === "claim" || kind === "atom" || kind === "topic";
}

/**
 * フォーカス種類以外のノードを、無向に隣接する「フォーカス種類のノードの数」で
 * 判定する（既定 focus は "note" で、今までの「ノート以外を畳む」と同じ結果）:
 *   - ちょうど 1 : その 1 つのフォーカスノードに畳む（+n）。互いの辺も一緒に消える
 *   - 0         : フォーカス種類に繋がっていない。
 *                 取り除くが特定の相手へは畳まない（foldedTotal にだけ数える）
 *   - 2 以上     : フォーカス種類をまたぐ橋なので骨格の一部として残す
 * すべて元データの隣接関係だけで 1 回の走査で決める（畳んだ結果を使って再判定しない
 * ＝連鎖させない）。
 */
export function foldLeafNodes(
  data: NoteGraphData,
  opts?: { focus?: FocusLayer },
): {
  data: NoteGraphData;
  foldedCount: Map<string, number>;
  foldedTotal: number;
  /** 畳まれた葉 id → 畳み先（親）フォーカスノード id。相手が無く単に取り除かれた
   *  （フォーカス隣接 0）ノードはここには入らない（foldedCount/foldedTotal にのみ数える）。
   *  layoutMode: islands で畳んだ葉を「衛星」として描き直すときに使う。 */
  foldedInto: Map<string, string>;
} {
  const focus = opts?.focus ?? "note";
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const neighborIds = new Map<string, string[]>();
  for (const n of data.nodes) neighborIds.set(n.id, []);
  for (const e of data.edges) {
    neighborIds.get(e.source)?.push(e.target);
    neighborIds.get(e.target)?.push(e.source);
  }

  const removeIds = new Set<string>();
  const foldedCount = new Map<string, number>();
  const foldedInto = new Map<string, string>();
  let foldedTotal = 0;

  for (const n of data.nodes) {
    if (isFocused(n, focus)) continue;
    const focusNeighbors = new Set<string>();
    for (const nbId of neighborIds.get(n.id) ?? []) {
      const nb = nodeById.get(nbId);
      if (nb && isFocused(nb, focus)) focusNeighbors.add(nbId);
    }
    if (focusNeighbors.size === 1) {
      const targetId = [...focusNeighbors][0];
      removeIds.add(n.id);
      foldedCount.set(targetId, (foldedCount.get(targetId) ?? 0) + 1);
      foldedInto.set(n.id, targetId);
      foldedTotal++;
    } else if (focusNeighbors.size === 0) {
      removeIds.add(n.id);
      foldedTotal++;
    }
    // 2 以上はフォーカス種類をまたぐ橋として残す（何もしない）
  }

  const nodes = data.nodes.filter((n) => !removeIds.has(n.id));
  const edges = data.edges.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target));
  return { data: { nodes, edges }, foldedCount, foldedTotal, foldedInto };
}

/**
 * フォーカス種類（既定 "note"）のノードごとに、辺を無向に hops（既定 2）ホップ
 * 以内でたどって届く別のフォーカスノードの数を返す。フォーカス以外の id は
 * Map に入れない。各ノードから素直に BFS を回す（ノード数百 × 辺数千なら
 * 十分速い）。
 */
export function computeReachScores(
  data: NoteGraphData,
  opts?: { hops?: number; focus?: FocusLayer },
): Map<string, number> {
  const hops = opts?.hops ?? 2;
  const focus = opts?.focus ?? "note";
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

  const focusIds = new Set(data.nodes.filter((n) => isFocused(n, focus)).map((n) => n.id));
  const scores = new Map<string, number>();

  for (const startId of focusIds) {
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
      if (focusIds.has(id)) score++;
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

/**
 * detectCommunities をフォーカス種類限定で走らせる（layoutMode: islands の裏側）。
 *
 * フォーカス種類のノード同士の**射影グラフ**でラベル伝播する。射影グラフの辺は:
 *   - 元データに直接の辺がある
 *   - focus が "note" 以外のときに限り、非フォーカスのノード（例: ノート）を
 *     1 つ共有していれば辺で繋ぐ（同じノートに付いた知見・同じノートで使われた
 *     原料を同じ島にするため）
 * focus が "note" のときは直接の辺だけを使う（共有隣接を使わない） ——
 * ノートは知見を共有しやすく、共有隣接で繋ぐと島が溶けてしまうため
 * （detectCommunities が全ノード込みでラベル伝播すると共有ノードが橋になり
 * 得るのと同じ理由）。
 *
 * フォーカス以外のノードは、直接隣接するフォーカスノード（1 ホップのみ。他の
 * ノードを経由した間接的な隣接は数えない）が所属するコミュニティの多数派に
 * 所属させる（同数なら文字列順で小さい方）。フォーカス種類に一つも隣接しない
 * ノードは戻り値の Map に入らない（「所属無し」）。
 */
export function detectFocusCommunities(data: NoteGraphData, focus: FocusLayer): Map<string, string> {
  const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
  const isFocusId = (id: string) => {
    const n = nodeById.get(id);
    return !!n && isFocused(n, focus);
  };

  const focusNodes = data.nodes.filter((n) => isFocused(n, focus));
  const focusIds = new Set(focusNodes.map((n) => n.id));

  // 直接の辺（両端がフォーカス種類）
  const projectionEdges = data.edges.filter((e) => focusIds.has(e.source) && focusIds.has(e.target));

  if (focus !== "note") {
    // 非フォーカスのノードを 1 つ共有しているフォーカスノード同士を辺で繋ぐ（射影）
    const focusNeighborsOfNonFocus = new Map<string, Set<string>>();
    for (const e of data.edges) {
      const sourceIsFocus = focusIds.has(e.source);
      const targetIsFocus = focusIds.has(e.target);
      if (sourceIsFocus && !targetIsFocus) {
        const set = focusNeighborsOfNonFocus.get(e.target) ?? new Set<string>();
        set.add(e.source);
        focusNeighborsOfNonFocus.set(e.target, set);
      } else if (targetIsFocus && !sourceIsFocus) {
        const set = focusNeighborsOfNonFocus.get(e.source) ?? new Set<string>();
        set.add(e.target);
        focusNeighborsOfNonFocus.set(e.source, set);
      }
    }
    for (const ids of focusNeighborsOfNonFocus.values()) {
      const list = [...ids];
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          projectionEdges.push({ source: list[i], target: list[j], relation: "derived" });
        }
      }
    }
  }

  const focusCommunities = detectCommunities({ nodes: focusNodes, edges: projectionEdges });
  const result = new Map<string, string>(focusCommunities);

  // フォーカス以外のノードごとに、直接隣接するフォーカスノードの id を集める
  const focusNeighborsOf = new Map<string, string[]>();
  for (const n of data.nodes) if (!isFocusId(n.id)) focusNeighborsOf.set(n.id, []);
  for (const e of data.edges) {
    const sourceIsFocus = isFocusId(e.source);
    const targetIsFocus = isFocusId(e.target);
    if (sourceIsFocus && !targetIsFocus) focusNeighborsOf.get(e.target)?.push(e.source);
    else if (targetIsFocus && !sourceIsFocus) focusNeighborsOf.get(e.source)?.push(e.target);
    // 両方フォーカス（projectionEdges 側で処理済み）/ 両方非フォーカスは対象外
  }

  for (const n of data.nodes) {
    if (isFocusId(n.id)) continue;
    const neighborFocusIds = focusNeighborsOf.get(n.id) ?? [];
    if (neighborFocusIds.length === 0) continue; // フォーカス種類に隣接しない → 所属無し
    const counts = new Map<string, number>();
    for (const fid of neighborFocusIds) {
      const community = focusCommunities.get(fid);
      if (community === undefined) continue;
      counts.set(community, (counts.get(community) ?? 0) + 1);
    }
    if (counts.size === 0) continue;
    let bestLabel: string | null = null;
    let bestCount = -1;
    for (const l of [...counts.keys()].sort()) {
      const c = counts.get(l)!;
      if (c > bestCount) {
        bestCount = c;
        bestLabel = l;
      }
    }
    if (bestLabel !== null) result.set(n.id, bestLabel);
  }
  return result;
}

/** detectFocusCommunities(data, "note") の薄いラッパー。既存の呼び出し元・
 *  テストとの互換のために残す。 */
export function detectNoteCommunities(data: NoteGraphData): Map<string, string> {
  return detectFocusCommunities(data, "note");
}
