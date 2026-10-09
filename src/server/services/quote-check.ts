// 引用照合（「AI が理由を作らない」ためのガード）
// LLM が返した引用が原文に実在するかを、正規化した部分一致で確かめる純関数群

/**
 * 照合用の正規化。
 * - NFKC（全角半角・㎏→kg などを統一）
 * - 空白・改行・タブを全除去
 * - 句読点の統一（、，→,  。．→.）
 * - 小文字化
 */
export function normalizeForQuoteMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[、，]/g, ",")
    .replace(/[。．]/g, ".")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * 引用が出典に出現するか。正規化後の引用が minLength 未満なら false
 * （短い語はほぼ必ず一致してしまうので照合に使えない）。
 */
export function quoteAppearsIn(quote: string, source: string, minLength = 6): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length < minLength) return false;
  return normalizeForQuoteMatch(source).includes(q);
}

/** 出典ごとに別々に照合する（連結すると継ぎ目で偽一致が起きるため）。いずれか 1 つに出れば true */
export function quoteAppearsInAny(quote: string, sources: string[], minLength = 6): boolean {
  return sources.some((s) => quoteAppearsIn(quote, s, minLength));
}

/** span 内に語・数値が出現するか。最短長の制限なし（item / value / unit の照合用） */
export function containsWithin(needle: string | number, haystack: string): boolean {
  const n = normalizeForQuoteMatch(String(needle));
  if (n.length === 0) return false;
  return normalizeForQuoteMatch(haystack).includes(n);
}
