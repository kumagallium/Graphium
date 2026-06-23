// URL Reader Mode (PR3-d)
// @mozilla/readability + linkedom で URL を「読める形」に変換して返す。
// PDF Quote-to-Memo (PR2 #339) と対称な体験を URL アセットに与えるための
// バックエンド。/api/url/reader から呼ばれる。
//
// url-fetcher.ts とは独立した経路:
//   - url-fetcher.ts: LLM ingest 用の軽量パス。タイトル + プレーンテキスト + 抜粋
//   - url-reader.ts: Reader View 用。Readability で本文 HTML を抽出し、選択 →
//     Memo 化のために textContent も一緒に返す
//
// linkedom を使う理由: jsdom はパッケージ内部資産（default-stylesheet.css /
// data/patch.json 等）をランタイムで読み込むため、esbuild の ESM single-file
// bundle に載せると sidecar 起動時に確実にクラッシュする（0.9.2 で実害発生）。
// linkedom は ESM ネイティブ・依存資産ゼロで bundle 可能。Readability が要求
// する DOM インタフェースは linkedom 側で満たされている。

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

// 多くのサイトは "Graphium/1.0" のような非ブラウザ UA を素で 403 にする。
// 現実的なブラウザ UA + 充実した Accept ヘッダにして互換性を上げる
// （Reader 系サービスの慣例。ただし Cloudflare 等の JS チャレンジは UA では突破できない）。
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const ACCEPT_LANGUAGE = "en-US,en;q=0.9";
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
  /**
   * 記事内の代表画像 URL（先頭の意味のある `<img>` を絶対 URL で）。
   * tracker 1x1 / data URI / 拡張子非画像は除外する。
   * 見つからなければ null。
   */
  leadImage: string | null;
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
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
        "Accept-Language": ACCEPT_LANGUAGE,
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "URL fetch failed";
    throw { status: 500, message } satisfies ReaderError;
  }

  if (!res.ok) {
    // Cloudflare 等のボット保護は、ブラウザでは開けてもサーバー側 fetch では
    // 403/503 になる（TLS フィンガープリント + JS チャレンジ）。UA では突破できない
    // ので、ユーザーが「サイト側の保護」だと分かる文言にして無駄な再試行を防ぐ。
    const server = (res.headers.get("server") ?? "").toLowerCase();
    const botProtected =
      res.headers.get("cf-mitigated") !== null ||
      ((res.status === 403 || res.status === 503) &&
        (server.includes("cloudflare") || server.includes("akamai")));
    throw {
      status: 400,
      message: botProtected
        ? `This page is behind bot protection (e.g. Cloudflare) and cannot be fetched from the server, even though it may open in your browser. Try a different URL. (${res.status})`
        : `Fetch failed: ${res.status} ${res.statusText}`,
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
  // linkedom で document を生成。スクリプトは実行されないため安全。
  // linkedom は `parseHTML(html, options)` に url を渡せないので、`<base href>`
  // を head に注入することで Readability の相対 URL 解決と documentURI/baseURI
  // を機能させる（既存の <base> がある場合はユーザー側を尊重して触らない）。
  const baseUrl = encodeAttr(url);
  let preparedHtml = html;
  if (!/<base[\s>]/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      preparedHtml = html.replace(/<head[^>]*>/i, (m) => `${m}<base href="${baseUrl}">`);
    } else if (/<html[^>]*>/i.test(html)) {
      // <head> が無い場合は <html> の直後に <head><base/></head> を差し込む
      preparedHtml = html.replace(/<html[^>]*>/i, (m) => `${m}<head><base href="${baseUrl}"></head>`);
    } else {
      preparedHtml = `<!doctype html><html><head><base href="${baseUrl}"></head><body>${html}</body></html>`;
    }
  }
  const { document: doc } = parseHTML(preparedHtml);
  // linkedom の document.documentURI は read-only な getter のみ提供されるケースが
  // あるため、Readability が直接 documentURI を読みに来るパスに備えて明示設定する。
  try {
    Object.defineProperty(doc, "documentURI", { value: url, configurable: true });
  } catch {
    // 既に固定の getter で設定されていたら諦める（Readability は baseURI 経由でも動く）
  }

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

  // 記事の lead image を抽出する（OGP より記事ごとの hero 画像を優先したい）
  // article.content は parsed HTML 断片なので、別の JSDOM で wrap して走査する
  const leadImage = extractLeadImage(article.content, url);

  return {
    url,
    title: article.title ?? "",
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    lang: article.lang ?? lang,
    content: sanitizeReaderHtml(article.content),
    textContent: normalizeWhitespace(article.textContent),
    excerpt: article.excerpt ?? "",
    leadImage,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * 本文 HTML から先頭の意味ある `<img>` を 1 件抽出して絶対 URL で返す。
 *
 * 除外条件:
 *   - width / height が 1 (tracker pixel)
 *   - data: URI（インライン画像、ほとんどはアイコン）
 *   - blank.gif / spacer.gif / pixel.gif 等の汎用空画像
 *   - srcset の先頭は src のフォールバック扱い
 */
export function extractLeadImage(contentHtml: string, baseUrl: string): string | null {
  // 相対 URL 解決はこの関数内で `new URL(rawSrc, baseUrl)` を明示的に行うので、
  // 文書側の baseURI は不要。linkedom に素の HTML だけ渡せばよい。
  const { document: doc } = parseHTML(
    `<!doctype html><html><body>${contentHtml}</body></html>`,
  );
  const imgs = Array.from(doc.querySelectorAll("img"));
  for (const img of imgs) {
    const w = parseInt(img.getAttribute("width") ?? "", 10);
    const h = parseInt(img.getAttribute("height") ?? "", 10);
    if (w === 1 || h === 1) continue;

    // src を取得。`<img data-src=...>` の lazy-load パターンも軽く拾う
    const rawSrc =
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-original") ||
      "";
    if (!rawSrc) continue;
    if (rawSrc.startsWith("data:")) continue;
    if (/(blank|spacer|pixel|transparent)\.(gif|png|webp)$/i.test(rawSrc)) continue;

    try {
      const absolute = new URL(rawSrc, baseUrl).toString();
      // http(s) のみ受け付ける（mailto:/javascript: 等を弾く）
      if (!/^https?:/i.test(absolute)) continue;
      return absolute;
    } catch {
      // 不正な URL → skip
      continue;
    }
  }
  return null;
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

/**
 * 注入用 `<base href="...">` の値として URL を埋め込めるように
 * HTML 属性で問題になる文字（&, ", <, >）だけ最小エスケープする。
 * URL 自体は RFC 的に "/<>& を生で持たないので、防衛的に処理する程度で十分。
 */
function encodeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
