// 出どころ情報の「文字としての扱い」（検索用の連結・語の一致・一覧の 1 行表示）。
//
// 純関数だけを置く。src/mcp（Node 側）からも使うので、pdfjs など
// ブラウザ依存のものを import しないこと（PDF の読み取りは source-info.ts）。

import type { SourceInfo } from "./media-index";

/** 検索用に authors・venue・year・doi を空白で連結する */
export function sourceInfoSearchText(info?: SourceInfo): string {
  if (!info) return "";
  const parts: string[] = [];
  if (info.authors && info.authors.length > 0) parts.push(info.authors.join(" "));
  if (info.venue) parts.push(info.venue);
  if (info.year !== undefined) parts.push(String(info.year));
  if (info.doi) parts.push(info.doi);
  return parts.join(" ");
}

/** 小文字化し、query を空白で分割した全トークンが haystack に含まれるか（空クエリは true） */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every((tok) => h.includes(tok));
}

/**
 * 一覧用の 1 行: 「筆頭著者の姓（最後の語） + (2 人以上なら etAl) · 年 · 発行元」。
 * 何も無ければ undefined。例: `Farris et al. · 2025 · JACS Au`
 */
export function formatSourceLine(info: SourceInfo | undefined, etAl: string): string | undefined {
  if (!info) return undefined;
  const parts: string[] = [];
  const authors = info.authors ?? [];
  if (authors.length > 0) {
    const words = authors[0].trim().split(/\s+/);
    const family = words[words.length - 1];
    if (family) parts.push(authors.length >= 2 ? `${family} ${etAl}` : family);
  }
  if (info.year !== undefined) parts.push(String(info.year));
  if (info.venue) parts.push(info.venue);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
