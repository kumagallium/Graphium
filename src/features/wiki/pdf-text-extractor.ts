// PDF からテキストを抽出するクライアント側ヘルパー
// react-pdf 同梱の pdfjs を流用する（追加依存なし）

import { pdfjs } from "react-pdf";

// 長文 PDF（100 ページ級の論文・資料）でも Summary が「冒頭しか読まなかった要約」に
// ならないよう、LLM に渡す上限を広めに取る。日本語混じりで概ね 60-90 ページぶん。
// それ以上はコスト・レイテンシが急増するので打ち切る。
const MAX_TEXT_CHARS = 80_000;

export type ExtractedPdf = {
  title: string;
  text: string;
  pageCount: number;
};

/**
 * PDF Blob からテキスト全体とメタタイトルを抽出する。
 * 長すぎる場合は MAX_TEXT_CHARS で打ち切る（LLM コンテキスト節約）。
 */
export async function extractPdfText(blob: Blob): Promise<ExtractedPdf> {
  const buffer = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  const pageCount = doc.numPages;
  const parts: string[] = [];
  let total = 0;
  let pagesRead = 0;

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .filter(Boolean)
      .join(" ");
    parts.push(pageText);
    total += pageText.length;
    pagesRead = i;
    if (total > MAX_TEXT_CHARS) break;
  }

  let text = parts.join("\n\n").trim();
  const truncated = pagesRead < pageCount || text.length > MAX_TEXT_CHARS;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  if (truncated) {
    // LLM に「全文を読んだ」と誤認させないため、何ページ中何ページまで読めたかを明示する
    text += `\n\n[... truncated: read ${pagesRead} of ${pageCount} pages]`;
  }

  let title = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as { Title?: string } | undefined;
    title = info?.Title?.trim() ?? "";
  } catch {
    // メタなし PDF はタイトル空のまま
  }

  return { title, text, pageCount };
}
