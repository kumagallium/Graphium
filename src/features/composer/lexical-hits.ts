// Cmd+K 用: 語彙インデックス（BM25）の検索結果を「ソースごと 1 件」に畳む
//
// searchNotes / searchMedia / searchShared は純関数のまま保ち、ここで lexicalSearch
// （同期）を引いて sourceId → { score, snippet } の Map にする。sourceId は kind ごとに
// noteId（note / wiki）・fileId（asset）・共有エントリ id（shared）。索引が未ロードなら
// 空 Map（＝従来どおりタイトル・見出し・OCR 部分一致だけで動く）。

import { bestHitsBySource, type LexicalSourceKind } from "../lexical-search";
import { parseQuery, type TextHit } from "./search";

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
  if (!text) return out;
  for (const [id, h] of bestHitsBySource(text, kinds, options)) out.set(id, { score: h.score, snippet: h.snippet });
  return out;
}
