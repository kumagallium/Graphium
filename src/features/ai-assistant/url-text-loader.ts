// URL 素材の本文テキスト取得（AI 文脈用, B-runtime）。
//
// LLM 加工前の原語原文を Reader 経由で取得し、セッション内キャッシュする。
// PDF を指す URL（arXiv 等）は Reader が本文を返せず {kind:"pdf"} を返すため、
// 表示系（PdfViewer）と同じ pdf-proxy 経由で PDF 本体を取得してテキスト抽出する。
// ここを単一チョークポイントにすることで、素材ビューの「AI に質問」・ノート側の
// @引用素材・URL 由来ドキュメントノートの grounding がすべて同じ経路で本文を得る。
//
// 永続保存版（B-persist: sourceTextFileId → loadMediaText）は note-app.tsx 側にあり、
// あちらが取れる場合はこの関数より優先される（cited-document-context の解決順）。

import { apiBase } from "../../lib/platform";

const urlTextCache = new Map<string, string>();

/** テスト用: セッションキャッシュをクリアする */
export function __clearUrlTextCacheForTest(): void {
  urlTextCache.clear();
}

/**
 * URL の本文プレーンテキストを取得する。
 * Reader 抽出（通常ページ）→ pdf-proxy + PDF テキスト抽出（PDF URL）の順で解決し、
 * オフライン・bot 保護・抽出失敗時は undefined を返す（呼び出し側は excerpt 等に
 * フォールバックする）。
 */
export async function loadUrlText(url: string): Promise<string | undefined> {
  const cached = urlTextCache.get(url);
  if (cached != null) return cached;
  try {
    const { fetchReaderArticle } = await import("../pdf-translate/translate-service");
    const article = await fetchReaderArticle(url);
    const text =
      article.kind === "pdf"
        ? await loadPdfUrlText(url)
        : (article.textContent || "").trim();
    if (!text) return undefined;
    urlTextCache.set(url, text);
    return text;
  } catch {
    return undefined;
  }
}

/**
 * PDF を指す URL の本文を pdf-proxy 経由で取得してテキスト抽出する。
 * react-pdf と同じくクロスオリジン fetch 制約があるため直接 fetch はせず、
 * 必ず同一オリジンの pdf-proxy を通す。
 */
async function loadPdfUrlText(url: string): Promise<string | undefined> {
  const res = await fetch(`${apiBase()}/url/pdf-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) return undefined;
  const blob = await res.blob();
  const { extractPdfText } = await import("../wiki/pdf-text-extractor");
  const { text } = await extractPdfText(blob);
  const trimmed = (text || "").trim();
  return trimmed || undefined;
}
