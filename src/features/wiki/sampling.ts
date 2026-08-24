// Discovery 用のサンプリング戦略
//
// 背景: Atomizer/Synthesizer は 1 プロンプトに最大 MAX_SNAPSHOTS_PER_RUN (=50) 件を
// フラットに並べて投げる設計のため、modifiedTime 降順の単純な上位 50 件だけを
// 使うと、直近に触られた領域（例: PROV / Graphium）が枠を独占し、
// 古い領域（例: 材料科学）が永遠に視野に入らない問題があった。
//
// 「類似クラスタ集中」サンプリング + カバレッジ実測プラン
//   - シード 1 件につき、シードに類似する上位 limit 件を 1 スライスとして LLM に渡す
//   - シード列は planCoverageSeeds() が決める: 未カバーの候補から farthest-point で
//     選び続け、全候補が少なくとも 1 回スライスに入るまで（= カバレッジ 100%）伸ばす
//   - 「1 クラスタあたり何件拾えるか」の見積もり係数は置かない。スライスは決定論なので
//     視野（和集合）を実測でき、必要回数・到達カバレッジはすべて計算値として返す
//
// 類似度は embedding が両方にあれば cosine、そうでなければ title + bodyPreview の
// トークン Jaccard でフォールバック。embedding 未生成の候補も対象から漏らさない。

import { embeddingStore } from "../../lib/embedding-store";
import { cosineSimilarity } from "../../lib/vector";
import type { ClaimSnapshot } from "../../server/services/wiki-types";

/** 1 Atom 分の入力（snapshot + 類似度計算用メタ） */
export type AtomCandidate = {
  snapshot: ClaimSnapshot;
  /** 類似度フォールバック用のテキスト（title + bodyPreview を結合したトークン集合の元） */
  similarityText: string;
  /** doc 単位の代表 embedding（section 平均）。embedding 未生成なら null */
  embedding: number[] | null;
  /** modifiedTime（最初のシード選びで直近を優先するため） */
  modifiedTime: string;
};

/** トークン化: 小文字化 + 非英数/非和文を区切りに、長さ 2 以上を採用 */
export function tokenize(text: string): Set<string> {
  if (!text) return new Set();
  const lower = text.toLowerCase();
  // 英数, ひらがな, カタカナ, 漢字以外で区切る
  const parts = lower.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
  return new Set(parts);
}

/** Jaccard 類似度（0..1） */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** コサイン類似度（0..1 に丸める。生 cosine は -1..1 だが embedding 用途では実質 0..1） */
export function cosine(a: number[], b: number[]): number {
  return cosineSimilarity(a, b, true);
}

/**
 * 2 つの AtomCandidate の類似度を返す。
 * 両方に embedding があれば cosine、そうでなければ Jaccard（同一スケール 0..1 として扱う）。
 */
export function similarity(
  a: AtomCandidate,
  b: AtomCandidate,
  tokenCache?: Map<AtomCandidate, Set<string>>,
): number {
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    return cosine(a.embedding, b.embedding);
  }
  const ta = tokenCache?.get(a) ?? tokenize(a.similarityText);
  const tb = tokenCache?.get(b) ?? tokenize(b.similarityText);
  if (tokenCache) {
    if (!tokenCache.has(a)) tokenCache.set(a, ta);
    if (!tokenCache.has(b)) tokenCache.set(b, tb);
  }
  return jaccard(ta, tb);
}

/**
 * doc 単位の代表 embedding を取得する。section 平均を返す。
 * embedding が 1 件も無ければ null。
 */
export async function getDocEmbedding(wikiDocId: string): Promise<number[] | null> {
  try {
    const records = await embeddingStore.getAllByDocument(wikiDocId);
    if (records.length === 0) return null;
    const dim = records[0].vector.length;
    if (dim === 0) return null;
    const avg = new Array<number>(dim).fill(0);
    for (const r of records) {
      if (r.vector.length !== dim) continue;
      for (let i = 0; i < dim; i++) avg[i] += r.vector[i];
    }
    for (let i = 0; i < dim; i++) avg[i] /= records.length;
    return avg;
  } catch {
    return null;
  }
}

/**
 * カバレッジ実測プラン。planCoverageSeeds() の戻り値。
 *
 * - `seeds[0..i]` を順に実行すると、視野（スライスの和集合）は
 *   `cumulativeCovered[i]` 件になる（単調増加、最後は totalCount = 100%）。
 * - 呼び出し側は予算 b で `seeds.slice(0, b)` と `cumulativeCovered[b-1]` を使う。
 *   `seeds.length` が「全件を視野に入れるのに必要な LLM 呼び出し回数」の実測値。
 */
export type CoveragePlan = {
  /** カバレッジ 100% に到達するまでの順序付きシード列 */
  seeds: AtomCandidate[];
  /** seeds[0..i] 実行後に視野に入る候補数（和集合・単調増加） */
  cumulativeCovered: number[];
  /** 母集団の総数 */
  totalCount: number;
};

/**
 * 全候補が少なくとも 1 回スライスに入るまでのシード列を決定論的に計画する。
 *
 * - 最初のシード: modifiedTime が最も新しい候補（直近触れた領域を 1 回は拾う）
 * - 以降のシード: **まだ視野に入っていない候補**のうち、既存シード集合への
 *   最大類似度が最小のもの（farthest-point の未カバー限定版）。
 *   シード自身は必ず自分のスライスに入るため、1 反復ごとに視野が少なくとも
 *   1 件増える = 必ず停止する。
 *
 * LLM は呼ばない（スライスは決定論なので視野は計算だけで実測できる）。
 * 計算量は O(totalCount × seeds.length) の類似度評価。
 */
export function planCoverageSeeds(
  atoms: AtomCandidate[],
  sliceLimit: number,
): CoveragePlan {
  if (atoms.length === 0 || sliceLimit <= 0) {
    return { seeds: [], cumulativeCovered: [], totalCount: atoms.length };
  }

  const tokenCache = new Map<AtomCandidate, Set<string>>();
  const covered = new Set<AtomCandidate>();
  const seeds: AtomCandidate[] = [];
  const cumulativeCovered: number[] = [];
  // 各候補の「これまでのシード集合への最大類似度」。次シード選びを O(n)/反復にする
  const maxSimToSeeds = new Map<AtomCandidate, number>();

  // 1 つ目: modifiedTime 降順で最新
  let seed: AtomCandidate | null =
    [...atoms].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];

  while (seed) {
    seeds.push(seed);
    for (const m of buildClusterSlice(atoms, seed, sliceLimit)) covered.add(m);
    cumulativeCovered.push(covered.size);
    if (covered.size >= atoms.length) break;

    // 未カバー候補の maxSim を今回のシード分だけ更新し、最遠の未カバー候補を次シードにする
    let bestAtom: AtomCandidate | null = null;
    let bestScore = Infinity; // 小さい = 既存シードから遠い
    for (const a of atoms) {
      if (covered.has(a)) continue;
      const sim = similarity(a, seed, tokenCache);
      const prev = maxSimToSeeds.get(a) ?? 0;
      const maxSim = sim > prev ? sim : prev;
      maxSimToSeeds.set(a, maxSim);
      if (maxSim < bestScore) {
        bestScore = maxSim;
        bestAtom = a;
      }
    }
    seed = bestAtom;
  }

  return { seeds, cumulativeCovered, totalCount: atoms.length };
}

/** 関連度ランキングに必要な最小フィーチャ。AtomCandidate のサブセット。 */
export type RelevanceFeature = {
  embedding: number[] | null;
  similarityText: string;
};

/** 2 つの RelevanceFeature の類似度（similarity() のサブセット版）。 */
function featureSimilarity(
  a: RelevanceFeature,
  b: RelevanceFeature,
  tokenCache: Map<RelevanceFeature, Set<string>>,
): number {
  if (a.embedding && b.embedding && a.embedding.length === b.embedding.length) {
    return cosine(a.embedding, b.embedding);
  }
  let ta = tokenCache.get(a);
  if (!ta) {
    ta = tokenize(a.similarityText);
    tokenCache.set(a, ta);
  }
  let tb = tokenCache.get(b);
  if (!tb) {
    tb = tokenize(b.similarityText);
    tokenCache.set(b, tb);
  }
  return jaccard(ta, tb);
}

/**
 * 「クエリから見た候補の関連度ランキング」を返す。
 *
 * 用途: Ingest マージ判定 / Cross-Update に渡す既存 Wiki の絞り込み。
 * 母集団が増えても LLM コンテキストが膨らまないように、similarity 上位だけを使う。
 *
 * 距離関数:
 *   - 両方に embedding があれば cosine
 *   - そうでなければ title + bodyPreview の Jaccard（fail-open）
 *
 * @returns score 降順にソートされた候補リスト（limit 件で打ち切り）。
 *          全候補数 ≤ limit の場合は **並べ替えだけ行って全件返す**
 *          （LLM の attention が頭の数件に強く効くため、関連度順は上から）。
 */
export function rankCandidatesByRelevance<T extends RelevanceFeature>(
  query: RelevanceFeature,
  candidates: T[],
  limit: number,
): T[] {
  if (candidates.length === 0 || limit <= 0) return [];
  const tokenCache = new Map<RelevanceFeature, Set<string>>();
  const scored = candidates.map((c) => ({
    candidate: c,
    score: featureSimilarity(query, c, tokenCache),
  }));
  scored.sort((a, b) => b.score - a.score);
  if (candidates.length <= limit) return scored.map((s) => s.candidate);
  return scored.slice(0, limit).map((s) => s.candidate);
}

/**
 * シード Atom を中心としたクラスタスライスを返す。
 * シード自身を含めて、類似度降順で上位 limit 件を返す。
 */
export function buildClusterSlice(
  atoms: AtomCandidate[],
  seed: AtomCandidate,
  limit: number,
): AtomCandidate[] {
  if (atoms.length === 0) return [];
  const tokenCache = new Map<AtomCandidate, Set<string>>();
  const scored = atoms.map((a) => ({
    atom: a,
    score: a === seed ? Infinity : similarity(a, seed, tokenCache),
  }));
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, limit).map((s) => s.atom);
}
