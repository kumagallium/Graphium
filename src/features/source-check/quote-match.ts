// 出典照合（Source check, v1） — quote → blockId 対応付け。
//
// サーバー側 quoteAppearsInSource（src/server/services/source-check.ts）と同じ正規化基準
// （NFKC + 連続空白圧縮 + trim）で「この quote はどのブロックに含まれるか」を探す。
// サーバーのモジュールはクライアントに import できない（バンドル境界。external-source.ts の
// コメント参照）ため、正規化ロジックをここに複製する。

import type { SourceTextBlock } from "./resolve-source-text";

function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * quote を含む唯一のブロックが一意に分かるときだけ blockId を返す。
 * 複数ブロックにまたがる／どのブロックにも見つからない／複数ブロックに一致する場合は
 * undefined（「一意に分かるとき」という仕様の条件を厳密に守る — 曖昧な紐付けはしない）。
 */
export function findBlockIdForQuote(
  blocks: SourceTextBlock[] | undefined,
  quote: string | undefined,
): string | undefined {
  if (!blocks || !quote) return undefined;
  const q = normalizeForMatch(quote);
  if (!q) return undefined;
  const matches = blocks.filter((b) => normalizeForMatch(b.text).includes(q));
  return matches.length === 1 ? matches[0].id : undefined;
}
