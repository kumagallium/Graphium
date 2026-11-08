// 全体グラフ（島の配置）で、島と島をまたぐ線を束ねる。
//
// 島の中の線は短く、束ねても見た目が変わらないので触らない。島をまたぐ線は長く、
// 同じ島どうしを結ぶ線が何本も並ぶので、束ねると島の間に「流れ」ができる。
// ノートが増えるほど流れが太くなり、育っていく様子が見える。
//
// 線は Cytoscape の辺のまま、曲線（unbundled-bezier）の制御点だけを差し替える。
// ホバーの強調・クリック・色などの既存の振る舞いはそのまま効く。

import type cytoscape from "cytoscape";
import { bundleEdges, type Point } from "./edge-bundling";

/** 制御点の数。多いほど束の形に忠実だが描画が重くなる */
const CONTROL_POINTS = 7;

/** 束ねる計算の周回数（分割数は 2 → 4 → 8 → 16） */
const BUNDLE_CYCLES = 4;

/** またぐ線がこれより多ければ束ねない（相性の判定が辺数の 2 乗で効くため） */
export const MAX_BUNDLED_EDGES = 2500;

/** 束ねるときに上書きするスタイル（外すときもこの一覧で外す） */
const BUNDLE_STYLE_KEYS = "curve-style control-point-distances control-point-weights edge-distances";

/**
 * 両端の島が分かっていて、かつ違う島どうしを結ぶ辺の id を返す。
 * 島の無いノード（どの島にも属さない資料など）に繋がる辺は含めない。
 */
export function pickCrossIslandEdges(
  edges: readonly { id: string; source: string; target: string }[],
  islandOf: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  for (const e of edges) {
    const a = islandOf.get(e.source);
    const b = islandOf.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) out.push(e.id);
  }
  return out;
}

/** 所属を広げる回数の上限（話題 → 知見 → ノート → 資料 の 3 段で足りる。余裕を見て 4） */
const SPREAD_ROUNDS = 4;

/**
 * 島の所属を、所属の無いノードへ広げる。所属の無いノードは、つながっている相手の島の
 * 多数派に入る（同数なら島 id の文字列順で小さい方）。1 回ごとに 1 歩ずつ広がる。
 * 知見中心の島（crystal）は所属表に話題しか持たないので、これで知見・ノート・資料にも
 * 島を付ける。元の所属は変えない。
 */
export function spreadIslands(
  edges: readonly { source: string; target: string }[],
  islandOf: ReadonlyMap<string, string>,
  rounds: number = SPREAD_ROUNDS,
): Map<string, string> {
  const result = new Map(islandOf);
  const neighbors = new Map<string, string[]>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    (neighbors.get(e.source) ?? neighbors.set(e.source, []).get(e.source)!).push(e.target);
    (neighbors.get(e.target) ?? neighbors.set(e.target, []).get(e.target)!).push(e.source);
  }
  for (let r = 0; r < rounds; r++) {
    const added = new Map<string, string>();
    for (const [id, ns] of neighbors) {
      if (result.has(id)) continue;
      const votes = new Map<string, number>();
      for (const n of ns) {
        const island = result.get(n);
        if (island !== undefined) votes.set(island, (votes.get(island) ?? 0) + 1);
      }
      let best: string | undefined;
      let bestCount = 0;
      for (const [island, count] of votes) {
        if (count > bestCount || (count === bestCount && best !== undefined && island < best)) {
          best = island;
          bestCount = count;
        }
      }
      if (best !== undefined) added.set(id, best);
    }
    if (added.size === 0) break;
    for (const [id, island] of added) result.set(id, island);
  }
  return result;
}

/** 島ごとの中心（所属するノードの位置の平均）。位置の分からないノードは数えない */
export function islandCenters(
  positions: ReadonlyMap<string, Point>,
  islandOf: ReadonlyMap<string, string>,
): Map<string, Point> {
  const sum = new Map<string, { x: number; y: number; n: number }>();
  for (const [id, island] of islandOf) {
    const p = positions.get(id);
    if (!p) continue;
    const acc = sum.get(island) ?? { x: 0, y: 0, n: 0 };
    acc.x += p.x;
    acc.y += p.y;
    acc.n += 1;
    sum.set(island, acc);
  }
  const out = new Map<string, Point>();
  for (const [island, acc] of sum) out.set(island, { x: acc.x / acc.n, y: acc.y / acc.n });
  return out;
}

/**
 * 位置で島を決める。fixed に所属があるノードはそのまま、ほかは一番近い島の中心の島に入れる。
 * 島が 1 つも無ければ fixed をそのまま返す。
 */
export function nearestIslands(
  positions: ReadonlyMap<string, Point>,
  centers: ReadonlyMap<string, Point>,
  fixed: ReadonlyMap<string, string>,
): Map<string, string> {
  const out = new Map(fixed);
  if (centers.size === 0) return out;
  for (const [id, p] of positions) {
    if (out.has(id)) continue;
    let best: string | undefined;
    let bestD = Infinity;
    for (const [island, c] of centers) {
      const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
      if (d < bestD || (d === bestD && best !== undefined && island < best)) {
        best = island;
        bestD = d;
      }
    }
    if (best !== undefined) out.set(id, best);
  }
  return out;
}

/**
 * 束ねた点列を、Cytoscape の unbundled-bezier の制御点（source→target の線に対する
 * 垂直距離と、線上の位置の割合）に変える。edge-distances: node-position 前提
 * （source / target はノードの中心）。
 * 垂直距離の符号は Cytoscape と同じ向き（source→target の向きを画面上で時計回りに
 * 90° 回した側が正。y は下向き）。
 */
export function toControlPoints(
  path: readonly Point[],
  source: Point,
  target: Point,
  count: number = CONTROL_POINTS,
): { distances: number[]; weights: number[] } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const l2 = dx * dx + dy * dy;
  const l = Math.sqrt(l2);
  if (l < 1e-6 || path.length < 3) return { distances: [], weights: [] };
  const distances: number[] = [];
  const weights: number[] = [];
  // 両端を除いた内点から、等間隔に count 個拾う
  const inner = path.length - 2;
  const n = Math.min(count, inner);
  for (let i = 0; i < n; i++) {
    const p = path[1 + Math.round(((i + 0.5) * inner) / n - 0.5)];
    const px = p.x - source.x;
    const py = p.y - source.y;
    weights.push((px * dx + py * dy) / l2);
    // (-dy, dx) の向き（source→target を画面上で時計回りに 90° 回した向き）が正。
    // Cytoscape の controlPoints() と照らして確かめた向き
    distances.push((px * -dy + py * dx) / l);
  }
  return { distances, weights };
}

/** 束ねたスタイルを外して、既定の曲線（graph-theme の unbundled-bezier）に戻す */
export function clearIslandEdgeBundling(cy: cytoscape.Core): void {
  cy.edges(".bundled").forEach((e) => {
    e.removeStyle(BUNDLE_STYLE_KEYS);
    e.removeClass("bundled");
  });
}

/**
 * 今のノード位置で、島をまたぐ実線を束ねる。前回の束ねは外してから掛け直す。
 * 島の中心は spreadIslands で広げた所属から求め、またぐかどうかは位置（nearestIslands）で判定する。
 * 束ね方は Force-Directed Edge Bundling（edge-bundling.ts）。島の中心を経由させる方式も
 * 試したが、島の端にいるノードの線が中心へ戻って U ターンするので採らなかった。
 * 不可視の線（重心・射影）と衛星の線は対象にしない。
 * 戻り値は束ねた線の本数（多すぎて束ねなかったときは 0）。
 */
export function applyIslandEdgeBundling(
  cy: cytoscape.Core,
  islandOf: ReadonlyMap<string, string>,
): number {
  clearIslandEdgeBundling(cy);
  const real = cy
    .edges()
    .filter((e) => !e.data("virtual") && !e.data("satellite") && !e.hasClass("cluster-edge")) as cytoscape.EdgeCollection;
  const list = real.map((e) => ({ id: e.id(), source: e.source().id(), target: e.target().id() }));
  // 島の中心: つながりの多数派で広げた所属から、所属するノード（衛星・不可視のノードを
  // 除く）の位置の平均を取る
  const spread = spreadIslands(list, islandOf);
  const positions = new Map<string, Point>();
  cy.nodes().forEach((node) => {
    if (node.data("satellite") || node.hasClass("cluster-hub")) return;
    positions.set(node.id(), { ...node.position() });
  });
  const centers = islandCenters(positions, spread);
  // 判定は見た目に合わせて位置で行う。元の所属（島の中心にした種類）はそのまま、
  // ほかは一番近い島の中心の島に入れる。知見中心の配置ではノート・資料が「つながる
  // 知見の平均位置」に置かれるので、つながりの多数派と見た目の島がずれるため
  const islands = nearestIslands(positions, centers, islandOf);
  const crossIds = new Set(pickCrossIslandEdges(list, islands));
  if (crossIds.size === 0 || crossIds.size > MAX_BUNDLED_EDGES) return 0;
  const targets = real.filter((e) => crossIds.has(e.id())) as cytoscape.EdgeCollection;
  const ends = targets.map((e) => ({ source: { ...e.source().position() }, target: { ...e.target().position() } }));

  // 制御点 7 個には 16 分割（4 周回）で足りる。5 周回目は時間が倍近くかかるので回さない
  const paths = bundleEdges(ends, { cycles: BUNDLE_CYCLES });

  cy.batch(() => {
    targets.forEach((e, i) => {
      const { distances, weights } = toControlPoints(paths[i], ends[i].source, ends[i].target);
      if (distances.length === 0) return;
      e.style({
        "curve-style": "unbundled-bezier",
        "edge-distances": "node-position",
        "control-point-distances": distances,
        "control-point-weights": weights,
      } as any);
      e.addClass("bundled");
    });
  });
  return targets.length;
}
