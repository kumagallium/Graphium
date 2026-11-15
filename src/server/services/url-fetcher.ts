// URL fetcher
// 外部 URL を取得し、HTML からタイトル・OGP・本文テキストを抽出する
// /api/wiki/fetch-url と /api/prov/ingest-url の両方から使う共通処理

import { parseHTML } from "linkedom";
import { BlockedTargetError, guardedFetch } from "./safe-fetch.js";

const USER_AGENT = "Graphium/1.0 (Knowledge Layer)";
const ACCEPT = "text/html,application/xhtml+xml,text/plain,application/pdf";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TEXT_CHARS = 5000;

export type FetchedPage = {
  url: string;
  title: string;
  description: string;
  text: string;
  /** 取得時点の ISO 8601 */
  fetchedAt: string;
};

export type FetchPageError = {
  status: number;
  message: string;
};

/**
 * URL を取得してプレーンテキスト + メタ情報を返す
 *
 * - PDF は未対応（明示エラー）
 * - script/style/nav/header/footer は除去
 * - 本文は maxTextChars で打ち切り（LLM コンテキスト節約）
 *
 * 正常時は FetchedPage を返し、失敗時は FetchPageError を throw する
 */
export async function fetchPageAsText(
  url: string,
  opts: { maxTextChars?: number } = {},
): Promise<FetchedPage> {
  const maxTextChars = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;

  let res: Response;
  try {
    // 利用者が指定する URL なので LAN は止めない。リンクローカルとクラウドのメタデータだけ、
    // リダイレクト先も含めて止める
    res = await guardedFetch(
      url,
      {
        headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
      "metadata-only",
    );
  } catch (err) {
    if (err instanceof BlockedTargetError) {
      throw { status: 403, message: "This host is not allowed" } satisfies FetchPageError;
    }
    const message = err instanceof Error ? err.message : "URL fetch failed";
    throw { status: 500, message } satisfies FetchPageError;
  }

  if (!res.ok) {
    throw {
      status: 400,
      message: `Fetch failed: ${res.status} ${res.statusText}`,
    } satisfies FetchPageError;
  }

  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("application/pdf")) {
    throw {
      status: 400,
      message:
        "Fetching PDF URLs directly is not supported. Paste the URL into a note as a PDF block, then run Ingest.",
    } satisfies FetchPageError;
  }

  const html = await res.text();
  const { title, description, text } = extractFromHtml(html, maxTextChars);

  return {
    url,
    title,
    description,
    text,
    fetchedAt: new Date().toISOString(),
  };
}

/** 本文テキストに含めない要素（実行物・装飾・ページの枠）。 */
const NON_CONTENT_SELECTOR = "script, style, noscript, template, nav, header, footer";

/**
 * HTML 文字列からタイトル・説明・本文を抽出する
 */
export function extractFromHtml(
  html: string,
  maxTextChars: number = DEFAULT_MAX_TEXT_CHARS,
): { title: string; description: string; text: string } {
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";
  const ogDescription =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    "";
  const metaDescription =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ?? "";

  // 本文は DOM（linkedom）で取り出す。正規表現でのタグ除去は `</script >` や
  // 入れ子で分断された形を取りこぼす。テキストノードを改行でつなぐので、
  // 「タグの位置で改行する」従来の見た目は保つ。エンティティは DOM がデコードする
  // （`&amp;lt;` は `&lt;` のまま。二重デコードしない）。
  // linkedom は文書の形をしていない断片を body に入れないので、包んでから解析する。
  const docHtml = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><head></head><body>${html}</body></html>`;
  const { document: doc } = parseHTML(docHtml);
  for (const el of Array.from(doc.querySelectorAll(NON_CONTENT_SELECTOR))) el.remove();
  const root = doc.body ?? doc.documentElement;
  // 改行は要素の境目（開きと閉じ）にだけ入れる。linkedom はエンティティの位置で
  // テキストノードを分けることがあるので、テキスト同士の間には入れない。
  const texts: string[] = [];
  type WalkNode = { nodeType: number; nodeValue: string | null; childNodes: ArrayLike<unknown> };
  const walk = (node: WalkNode) => {
    if (node.nodeType === 3) {
      texts.push((node.nodeValue ?? "").replace(/\u00a0/g, " "));
      return;
    }
    texts.push("\n");
    for (const child of Array.from(node.childNodes)) walk(child as WalkNode);
    texts.push("\n");
  };
  if (root) for (const child of Array.from(root.childNodes)) walk(child as unknown as WalkNode);
  let bodyText = texts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (bodyText.length > maxTextChars) {
    bodyText = bodyText.slice(0, maxTextChars) + "\n\n[... truncated]";
  }

  return {
    title: ogTitle || titleTag,
    // title は trim() しているのに description はしていなかった非対称を無くす。
    // 空白だけの description（実質空）が呼び出し側の空判定をすり抜ける一次原因の 1 つ。
    description: (ogDescription || metaDescription).trim(),
    text: bodyText,
  };
}
