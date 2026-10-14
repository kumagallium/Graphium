/**
 * 類似性の引力（実験）: 埋め込みの近い知見どうしを、島の中で寄せる。
 *
 * 島配置の幾何パスは知見を「隣接する話題・資料の平均位置」に置くので、同じ島の
 * 中で知見がどう並ぶかは恣意的だった。ここでは、同じ島（group）に属し、埋め込みの
 * コサイン類似度が threshold 以上のペアを弱いばねで引き寄せ、各知見は元の位置
 * （anchor）にも弱いばねで繋いで島から出ないようにする。
 *
 * - 島をまたぐペアは結ばない（「近さ＝つながり」の読みを壊さない）
 * - 1 件あたり maxNeighbors 本までに絞る（密なクリークで 1 点に潰れないように）
 * - 埋め込みの無い知見は動かさない（anchor のまま）
 * - しきい値の既定 0.7 は「関連がある」の目安（重複判定の 0.9 より緩い）。埋め込み
 *   モデルで分布が変わるので、効きが弱い／強すぎるときはここを調整する
 * - 決定的（乱数を使わない）
 * - 重なりの解消は別パス（overlap-resolver）に任せる
 */
import { cosineSimilarity } from "../../lib/vector";

export type SimilarityItem = {
  id: string;
  x: number;
  y: number;
  /** 島の識別子。同じ値のペアだけ結ぶ */
  group: string;
  vector?: number[];
};

export type SimilarityPullOptions = {
  /** これ以上のコサイン類似度のペアだけ結ぶ */
  threshold?: number;
  /** 1 件が結ぶ相手の上限（類似度の高い順） */
  maxNeighbors?: number;
  iterations?: number;
  /** 元の位置へ戻る強さ（0〜1） */
  anchorStrength?: number;
  /** 類似相手へ寄る強さ（0〜1、類似度で重み付け） */
  pullStrength?: number;
};

export type SimilarityPullResult = {
  positions: Map<string, { x: number; y: number }>;
  /** 結んだペアの数 */
  pairs: number;
  /** 埋め込みがあって計算に参加した件数 */
  participants: number;
};

export function pullBySimilarity(
  items: readonly SimilarityItem[],
  opts: SimilarityPullOptions = {},
): SimilarityPullResult {
  const threshold = opts.threshold ?? 0.7;
  const maxNeighbors = opts.maxNeighbors ?? 5;
  const iterations = opts.iterations ?? 60;
  const anchorStrength = opts.anchorStrength ?? 0.05;
  const pullStrength = opts.pullStrength ?? 0.08;

  const positions = new Map<string, { x: number; y: number }>();
  for (const it of items) positions.set(it.id, { x: it.x, y: it.y });

  // 島ごとに、埋め込みのある知見だけを集める
  const byGroup = new Map<string, SimilarityItem[]>();
  for (const it of items) {
    if (!it.vector || it.vector.length === 0) continue;
    const list = byGroup.get(it.group);
    if (list) list.push(it);
    else byGroup.set(it.group, [it]);
  }

  // 近傍リスト（id → [{id, weight}]）。weight は (sim − threshold)/(1 − threshold) で 0〜1
  const neighbors = new Map<string, { id: string; weight: number }[]>();
  let participants = 0;
  const pairKeys = new Set<string>();
  for (const list of byGroup.values()) {
    if (list.length < 2) continue;
    participants += list.length;
    const sims: { id: string; sim: number }[][] = list.map(() => []);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const sim = cosineSimilarity(list[i].vector!, list[j].vector!);
        if (sim < threshold) continue;
        sims[i].push({ id: list[j].id, sim });
        sims[j].push({ id: list[i].id, sim });
      }
    }
    list.forEach((it, i) => {
      const top = sims[i].sort((a, b) => b.sim - a.sim || (a.id < b.id ? -1 : 1)).slice(0, maxNeighbors);
      neighbors.set(
        it.id,
        top.map((t) => ({ id: t.id, weight: (t.sim - threshold) / Math.max(1e-6, 1 - threshold) })),
      );
      for (const t of top) pairKeys.add(it.id < t.id ? `${it.id}|${t.id}` : `${t.id}|${it.id}`);
    });
  }
  if (pairKeys.size === 0) return { positions, pairs: 0, participants };

  const anchor = new Map(items.map((it) => [it.id, { x: it.x, y: it.y }]));
  const moving = [...neighbors.keys()];
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, { x: number; y: number }>();
    for (const id of moving) {
      const p = positions.get(id)!;
      const a = anchor.get(id)!;
      let fx = (a.x - p.x) * anchorStrength;
      let fy = (a.y - p.y) * anchorStrength;
      for (const nb of neighbors.get(id) ?? []) {
        const q = positions.get(nb.id)!;
        fx += (q.x - p.x) * pullStrength * nb.weight;
        fy += (q.y - p.y) * pullStrength * nb.weight;
      }
      next.set(id, { x: p.x + fx, y: p.y + fy });
    }
    for (const [id, p] of next) positions.set(id, p);
  }
  return { positions, pairs: pairKeys.size, participants };
}
