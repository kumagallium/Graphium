// 語彙インデックスの検索結果を「ソースごとに最良の 1 件」に畳む共通ヘルパー
//
// Cmd-K（composer/lexical-hits.ts）とノート一覧の検索が同じ形で使う。
// 索引が未ロードなら空 Map（＝呼び出し側は従来どおりの一致だけで動く）。

import { lexicalSearch } from "./service";
import { buildSnippet, type Snippet } from "./snippet";
import { queryTerms } from "./tokenizer";
import type { LexicalSourceKind } from "./lexical-index";

/** ソースごとに畳んだヒット */
export type BestHit = {
  kind: LexicalSourceKind;
  sourceId: string;
  title: string;
  /** BM25 スコア（相対値） */
  score: number;
  snippet: Snippet;
};

/** 走査するチャンク数の上限（ソースごと 1 件に畳む前） */
const SCAN_LIMIT = 40;

/**
 * フリーテキストで語彙インデックスを引き、ソース id ごとに最良の 1 件を返す。
 * 長めの入力（トークン 4 語以上）では 1 語だけで当たる弱い候補を落とす。短い入力は OR のまま。
 */
export function bestHitsBySource(
  text: string,
  kinds: LexicalSourceKind[],
  options: { excludeSourceIds?: ReadonlySet<string>; limit?: number } = {},
): Map<string, BestHit> {
  const q = (text ?? "").trim();
  const out = new Map<string, BestHit>();
  if (!q || !lexicalSearch.isReady()) return out;
  const words = q.split(/\s+/).filter(Boolean);
  // 語数は空白ではなくトークン（日本語は空白で切れない）で数える
  const termCount = queryTerms(q).length;
  const hits = lexicalSearch.search(q, {
    kinds,
    limit: options.limit ?? SCAN_LIMIT,
    perSourceLimit: 1,
    excludeSourceIds: options.excludeSourceIds,
    minTermMatches: termCount >= 4 ? 2 : 1,
  });
  for (const h of hits) {
    if (out.has(h.sourceId)) continue;
    // 生の入力語（句のまま）を先に、ヒットした語を後に渡す。長い語が優先して強調される
    out.set(h.sourceId, { kind: h.kind, sourceId: h.sourceId, title: h.title, score: h.score, snippet: buildSnippet(h.text, [...words, ...h.terms]) });
  }
  return out;
}
