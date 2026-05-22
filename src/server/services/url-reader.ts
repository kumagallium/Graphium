// URL Reader Mode (PR3-d)
// @mozilla/readability + jsdom で URL を「読める形」に変換して返す。
// PDF Quote-to-Memo (PR2 #339) と対称な体験を URL アセットに与えるための
// バックエンド。/api/url/reader から呼ばれる。
//
// url-fetcher.ts とは独立した経路:
//   - url-fetcher.ts: LLM ingest 用の軽量パス。タイトル + プレーンテキスト + 抜粋
//   - url-reader.ts: Reader View 用。Readability で本文 HTML を抽出し、選択 →
//     Memo 化のために textContent も一緒に返す

import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const USER_AGENT = "Graphium/1.0 (Reader)";
const ACCEPT = "text/html,application/xhtml+xml";
const FETCH_TIMEOUT_MS = 15_000;

export type ReaderArticle = {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  /** Readability が抽出した本文 HTML（sanitize 済み） */
  content: string;
  /** 本文プレーンテキスト（textFragment 構築用） */
  textContent: string;
  /** Readability の自動要約（先頭 1-2 段落、空文字の可能性あり） */
  excerpt: string;
  fetchedAt: string;
};

export type ReaderError = {
  status: 400 | 422 | 500;
  message: string;
};

/**
 * URL を fetch して Readability で本文抽出する。
 *
 * 失敗パターン:
 * - fetch 失敗 → 500
 * - HTTP non-200 → 400
 * - PDF / 非 HTML → 400（PDF は別経路）
 * - Readability が null を返した（reader 不能） → 422
 */
export async function fetchAsReaderArticle(url: string): Promise<ReaderArticle> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL fetch failed";
    throw { status: 500, message } satisfies ReaderError;
  }

  if (!res.ok) {
    throw {
      status: 400,
      message: `Fetch failed: ${res.status} ${res.statusText}`,
    } satisfies ReaderError;
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf")) {
    throw {
      status: 400,
      message:
        "PDF URL は Reader Mode で扱えません。PDF ブロックとしてノートに貼り付けてください。",
    } satisfies ReaderError;
  }

  const finalUrl = res.url || url;
  const html = await res.text();

  return extractReaderFromHtml(html, finalUrl);
}

/**
 * HTML 文字列から Reader 表現を抽出する（fetch 部分を切り離してテスト可能に）。
 */
export function extractReaderFromHtml(html: string, url: string): ReaderArticle {
  // JSDOM を生成。`runScripts` は指定しないので JS は実行されない（安全）。
  // url は Readability の相対リンク解決と「同一サイト判定」に使われる。
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // lang は <html lang="..."> から事前に拾う（Readability が削るケースに備える）
  const lang = doc.documentElement.getAttribute("lang");

  const reader = new Readability(doc, {
    // 本文要素以外も拾うとサイドバーが混じる。Mozilla のデフォルトに任せる
    charThreshold: 500,
    // 通常 keepClasses は false。Reader 表示で見出しなど最小限の見た目を取りたい
    keepClasses: false,
  });

  const article = reader.parse();
  if (!article || !article.content || !article.textContent) {
    throw {
      status: 422,
      message: "Readability extraction returned null",
    } satisfies ReaderError;
  }

  return {
    url,
    title: article.title ?? "",
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    lang: article.lang ?? lang,
    content: sanitizeReaderHtml(article.content),
    textContent: normalizeWhitespace(article.textContent),
    excerpt: article.excerpt ?? "",
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Readability の出力 HTML に対する軽量サニタイズ。
 *
 * Readability 自体が JSDOMParser ベースで `<script>` 等の危険要素を落としているが、
 * 念のため:
 *   - script / style / iframe / object / embed / link は削除
 *   - on* 属性（onclick 等）は削除
 *   - javascript: で始まる href / src を `#` に置換
 *
 * Reader 表示は本文のテキストを読ませるのが目的なので、外部リソースを過剰に許可しない。
 */
export function sanitizeReaderHtml(html: string): string {
  // 危険なタグを丸ごと除去
  let out = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?>/gi, "")
    .replace(/<link[\s\S]*?>/gi, "");

  // on* イベントハンドラ属性
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");

  // javascript: URL
  out = out.replace(/(href|src)\s*=\s*"javascript:[^"]*"/gi, '$1="#"');
  out = out.replace(/(href|src)\s*=\s*'javascript:[^']*'/gi, "$1='#'");

  return out;
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[  -​]+/g, " ") // nbsp 等の特殊空白
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 取得結果のメモリ LRU キャッシュ ──
// 同一 URL の再取得を防ぐ。Reader Mode は読み返し頻度が高いので 30s で十分。
// 永続化はしない（プロセス再起動で消える）。

type CacheEntry = { article: ReaderArticle; expiresAt: number };
const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 256;
const cache = new Map<string, CacheEntry>();

export function getCachedReaderArticle(url: string): ReaderArticle | null {
  const entry = cache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(url);
    return null;
  }
  // LRU: 取得した key を末尾に移す
  cache.delete(url);
  cache.set(url, entry);
  return entry.article;
}

export function setCachedReaderArticle(url: string, article: ReaderArticle): void {
  if (cache.size >= CACHE_MAX) {
    // 先頭（最古）を 1 つ捨てる
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(url, { article, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** テスト用。プロセス内のキャッシュをクリア。 */
export function clearReaderCache(): void {
  cache.clear();
}
