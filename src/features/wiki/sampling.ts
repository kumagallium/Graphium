// Synthesis Discovery 用のサンプリング戦略
//
// 背景: Synthesizer は 1 プロンプトに最大 MAX_SNAPSHOTS_PER_RUN (=50) の Atom を
// フラットに並べて投げる設計のため、modifiedTime 降順の単純な上位 50 件だけを
// 使うと、直近に触られた領域（例: PROV / Graphium）が枠を独占し、
// 古い領域（例: 材料科学）の Atom が永遠に視野に入らない問題があった。
//
// Phase 1: 「類似クラスタ集中」サンプリング
//   - 全 Atom 母集団から「シード Atom」を iteration 数だけ選ぶ
//   - シード同士は farthest-point sampling で互いに離す（領域の網羅性を上げる）
//   - 各 iteration では、シードに類似する Atom 上位 limit 件を 1 スライスとして
//     synthesizer に渡す
//
// 類似度は embedding が両方にあれば cosine、そうでなければ title + bodyPreview の
// トークン Jaccard でフォールバック。embedding 未生成の Atom も対象から漏らさない。

import { embeddingStore } from "../../lib/embedding-store";
import type { ClaimSnapshot } from "../../server/services/wiki-synthesizer";

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
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  const sim = dot / denom;
  return sim < 0 ? 0 : sim > 1 ? 1 : sim;
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
 * Farthest-point sampling でシード Atom を K 件選ぶ。
 * - 最初のシード: modifiedTime が最も新しい Atom（直近触れた領域を 1 回は拾う）
 * - 以降のシード: 既に選ばれたシード集合への「最大類似度」が最も小さい Atom を選ぶ
 *   （= 既存シードから最も遠い Atom）
 *
 * これにより、シードは Atom 空間の異なる領域に分散する。
 */
export function pickFarthestSeeds(
  atoms: AtomCandidate[],
  k: number,
): AtomCandidate[] {
  if (atoms.length === 0 || k <= 0) return [];
  if (atoms.length <= k) return [...atoms];

  const tokenCache = new Map<AtomCandidate, Set<string>>();
  const seeds: AtomCandidate[] = [];

  // 1 つ目: modifiedTime 降順で最新
  const byTime = [...atoms].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  seeds.push(byTime[0]);

  // 2 つ目以降: 既存シード集合への max similarity が最小の Atom
  while (seeds.length < k) {
    let bestAtom: AtomCandidate | null = null;
    let bestScore = Infinity; // 小さい = 既存シードから遠い
    for (const a of atoms) {
      if (seeds.includes(a)) continue;
      let maxSim = 0;
      for (const s of seeds) {
        const sim = similarity(a, s, tokenCache);
        if (sim > maxSim) maxSim = sim;
      }
      if (maxSim < bestScore) {
        bestScore = maxSim;
        bestAtom = a;
      }
    }
    if (!bestAtom) break;
    seeds.push(bestAtom);
  }
  return seeds;
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
 * 母集団のアイテム数からクラスタ数（= seed 数 = LLM 呼び出し回数）を動的決定する。
 *
 *   K = clamp( ceil(itemCount / effectiveCoverage), 1, maxK )
 *
 * - `effectiveCoverage` は「1 クラスタが新規に拾うユニーク件数の見積もり」。
 *   各クラスタは sliceSize (=50) 件を含むが、クラスタ間で重複があるので
 *   実効的なユニークカバーはそれより小さい。経験則で 60% 程度として 30 を採用。
 * - `maxK` は 1 クリックあたりの LLM コスト天井。
 *
 * 例: itemCount=250, effectiveCoverage=30, maxK=8 → K = min(ceil(250/30), 8) = 8
 *     itemCount=80,  effectiveCoverage=30, maxK=8 → K = min(3, 8) = 3
 *     itemCount=30,  effectiveCoverage=30, maxK=8 → K = min(1, 8) = 1
 */
export function pickClusterCount(
  itemCount: number,
  opts: { effectiveCoverage: number; maxK: number },
): number {
  if (itemCount <= 0) return 0;
  const k = Math.ceil(itemCount / Math.max(1, opts.effectiveCoverage));
  return Math.min(Math.max(1, k), opts.maxK);
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
