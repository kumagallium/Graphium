// 全体グラフの「内容の島」: 話題（topic）どうしを埋め込みの近さで結ぶ。
//
// つながりの島（共有資料・共有知見）は作業の系譜を表すが、同じ論文を引くだけで
// 内容の違う話題が 1 つの島になり、同じテーマでも別の資料から組んだ話題は別の島に
// 分かれる。話題はもともと内容の単位なので、知識層を俯瞰するときは内容で寄せる。
//
// 結び方は「相互 k 近傍 ＋ 各自の最近傍 1 本」（下限 minSimilarity 以上）:
// - k 近傍をそのまま結ぶと、多くの話題の近傍に入る話題（ハブ）を介して全体が
//   1 つの島に連鎖する。相互に近傍に入る組だけにすると連鎖しにくい
// - 相互だけだと孤立する話題が出るので、各自の最近傍 1 本は必ず結ぶ
// - 決定的（乱数を使わない）

import { cosineSimilarity } from "../../lib/vector";

export interface ContentTopicEdge {
  source: string;
  target: string;
  /** コサイン類似度 */
  similarity: number;
}

export interface ContentEdgeOptions {
  /** 相互近傍を見る近傍の数 */
  k?: number;
  /** これ未満の類似度の組は結ばない（最近傍 1 本も含む） */
  minSimilarity?: number;
}

/**
 * 埋め込みのある話題どうしの辺を作る。ベクトルの無い話題は含めない
 * （呼び出し側でつながりの辺を使って島に入れる）。
 */
export function buildContentTopicEdges(
  topicIds: readonly string[],
  vectors: ReadonlyMap<string, number[]>,
  opts: ContentEdgeOptions = {},
): ContentTopicEdge[] {
  const k = opts.k ?? 5;
  const minSim = opts.minSimilarity ?? 0.5;
  const ids = [...topicIds].filter((id) => (vectors.get(id)?.length ?? 0) > 0).sort();
  const n = ids.length;
  // 類似度の行列（上三角だけ計算して対称に埋める）
  const sim: number[][] = ids.map(() => new Array<number>(n).fill(-Infinity));
  for (let i = 0; i < n; i++) {
    const a = vectors.get(ids[i])!;
    for (let j = i + 1; j < n; j++) {
      const s = cosineSimilarity(a, vectors.get(ids[j])!);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }
  // 各自の近傍（類似度の高い順、同点は id 順）
  const neighbors: number[][] = [];
  for (let i = 0; i < n; i++) {
    const order = [...Array(n).keys()]
      .filter((j) => j !== i && sim[i][j] >= minSim)
      .sort((x, y) => sim[i][y] - sim[i][x] || x - y);
    neighbors.push(order.slice(0, k));
  }
  const edges = new Map<string, ContentTopicEdge>();
  const add = (i: number, j: number) => {
    const [a, b] = i < j ? [i, j] : [j, i];
    const key = `${a}|${b}`;
    if (!edges.has(key)) edges.set(key, { source: ids[a], target: ids[b], similarity: sim[a][b] });
  };
  for (let i = 0; i < n; i++) {
    const nb = neighbors[i];
    if (nb.length > 0) add(i, nb[0]);
    for (const j of nb) if (neighbors[j].includes(i)) add(i, j);
  }
  return [...edges.values()];
}

/**
 * 島の重心（メンバーのベクトルの平均）に近い順に並べる。ベクトルの無いメンバーは
 * 末尾（元の順のまま）。内容の島の名前は、つながりの多さではなくこの順で選ぶ
 * （つながりで選ぶと、資料を多く引く大きな話題が名前を取ってしまう）。
 */
export function rankByCentroid(ids: readonly string[], vectors: ReadonlyMap<string, number[]>): string[] {
  const withVec = ids.filter((id) => (vectors.get(id)?.length ?? 0) > 0);
  if (withVec.length === 0) return [...ids];
  const dim = vectors.get(withVec[0])!.length;
  const centroid = new Array<number>(dim).fill(0);
  let count = 0;
  for (const id of withVec) {
    const v = vectors.get(id)!;
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i++) centroid[i] += v[i];
    count++;
  }
  if (count === 0) return [...ids];
  const score = new Map(withVec.map((id) => [id, cosineSimilarity(vectors.get(id)!, centroid)]));
  const ranked = [...withVec].sort((a, b) => score.get(b)! - score.get(a)! || a.localeCompare(b));
  const rest = ids.filter((id) => !score.has(id));
  return [...ranked, ...rest];
}
