// Cmd+K 用: 語彙インデックス（BM25）の検索結果を「ソースごと 1 件」に畳む
//
// searchNotes / searchMedia は純関数のまま保ち、ここで lexicalSearch（同期）を
// 引いて noteId / fileId → { score, snippet } の Map にする。索引が未ロードなら
// 空 Map（＝従来どおりタイトル・見出し・OCR 部分一致だけで動く）。

import { lexicalSearch, buildSnippet, queryTerms, type LexicalSourceKind } from "../lexical-search";
import { parseQuery, type TextHit } from "./search";

/** 走査するチャンク数の上限（ソースごと 1 件に畳む前） */
const LEXICAL_SCAN_LIMIT = 40;

/**
 * クエリのフリーテキスト部分で語彙インデックスを引き、ソース id ごとに最良の 1 件を返す。
 * `#ラベル` / `@作者` は searchNotes 側のフィルタなのでここでは無視する。
 */
export function collectLexicalHits(
  query: string,
  kinds: LexicalSourceKind[],
  options: { excludeSourceIds?: ReadonlySet<string> } = {},
): Map<string, TextHit> {
  const text = parseQuery(query).text.trim();
  const out = new Map<string, TextHit>();
  if (!text || !lexicalSearch.isReady()) return out;
  const words = text.split(/\s+/).filter(Boolean);
  // 語数は空白ではなくトークン（日本語は空白で切れない）で数える
  const termCount = queryTerms(text).length;
  const hits = lexicalSearch.search(text, {
    kinds,
    limit: LEXICAL_SCAN_LIMIT,
    perSourceLimit: 1,
    excludeSourceIds: options.excludeSourceIds,
    // 長めの入力（4 語以上）では 1 語だけで当たる弱い候補を落とす。短い入力は OR のまま
    minTermMatches: termCount >= 4 ? 2 : 1,
  });
  for (const h of hits) {
    if (out.has(h.sourceId)) continue;
    // 生の入力語（句のまま）を先に、ヒットした語を後に渡す。長い語が優先して強調される
    out.set(h.sourceId, { score: h.score, snippet: buildSnippet(h.text, [...words, ...h.terms]) });
  }
  return out;
}
