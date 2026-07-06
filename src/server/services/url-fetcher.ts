// URL fetcher
// 外部 URL を取得し、HTML からタイトル・OGP・本文テキストを抽出する
// /api/wiki/fetch-url と /api/prov/ingest-url の両方から使う共通処理

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
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
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

  let bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (bodyText.length > maxTextChars) {
    bodyText = bodyText.slice(0, maxTextChars) + "\n\n[... truncated]";
  }

  return {
    title: ogTitle || titleTag,
    description: ogDescription || metaDescription,
    text: bodyText,
  };
}
