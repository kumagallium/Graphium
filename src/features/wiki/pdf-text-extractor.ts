// PDF からテキストを抽出するクライアント側ヘルパー
// react-pdf 同梱の pdfjs を流用する（追加依存なし）

import { pdfjs } from "react-pdf";
import { PDFJS_DOC_OPTIONS } from "../../lib/pdfjs-config";

// 長文 PDF（100 ページ級の論文・資料）でも Summary が「冒頭しか読まなかった要約」に
// ならないよう、LLM に渡す上限を広めに取る。日本語混じりで概ね 60-90 ページぶん。
// それ以上はコスト・レイテンシが急増するので打ち切る。
const MAX_TEXT_CHARS = 80_000;

// 打ち切り注記の先頭（出典照合の quote-match.ts が「出現位置がこの注記内か」を
// 判定するのに使う。バンドル境界の事情で quote-match.ts 側にも複製してある —
// 値を変えるときは両方直すこと）。
export const PDF_TRUNCATION_MARKER = "\n\n[... truncated: read ";

export type ExtractedPdf = {
  title: string;
  text: string;
  pageCount: number;
  /** pageStarts[i] = 返す text 上で (i+1) ページ目のテキストが始まる文字オフセット。読んだページ数ぶん。
   *  出典照合（quote-match.ts の resolveQuoteLocation）がページ番号を解くのに使う。 */
  pageStarts?: number[];
};

/**
 * PDF Blob からテキスト全体とメタタイトルを抽出する。
 * 長すぎる場合は MAX_TEXT_CHARS で打ち切る（LLM コンテキスト節約）。
 */
export async function extractPdfText(blob: Blob): Promise<ExtractedPdf> {
  const buffer = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), ...PDFJS_DOC_OPTIONS }).promise;

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

  // parts.join("\n\n") 前の、各ページ開始オフセットを先に出しておく（join は
  // ページ間に "\n\n"（2 文字）を挟むだけなので、結合後のオフセットも機械的に求まる）。
  const rawPageStarts: number[] = [];
  {
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      rawPageStarts.push(offset);
      offset += parts[i].length + (i < parts.length - 1 ? 2 : 0);
    }
  }

  const joined = parts.join("\n\n");
  let text = joined.trim();
  // 先頭 trim で削れた文字数だけ、各ページ開始オフセットを引く。
  const leadingTrimmed = joined.length - joined.trimStart().length;
  let pageStarts = rawPageStarts.map((s) => Math.max(0, s - leadingTrimmed));

  const truncated = pagesRead < pageCount || text.length > MAX_TEXT_CHARS;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
  }
  // スライス後の本文長（この時点の text.length）以上から始まるページは、もう
  // 本文に存在しない（打ち切り注記より後ろに追いやられた扱い）ので含めない。
  const bodyLength = text.length;
  pageStarts = pageStarts.filter((s) => s < bodyLength);
  if (truncated) {
    // LLM に「全文を読んだ」と誤認させないため、何ページ中何ページまで読めたかを明示する
    text += `${PDF_TRUNCATION_MARKER}${pagesRead} of ${pageCount} pages]`;
  }

  let title = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as { Title?: string } | undefined;
    title = info?.Title?.trim() ?? "";
  } catch {
    // メタなし PDF はタイトル空のまま
  }

  return { title, text, pageCount, pageStarts };
}

// 翻訳取り込み用の上限。要約と違い「全文」を訳すため Summary より広く取る。
// それでも巨大な PDF はコスト・レイテンシが膨らむので上限で打ち切る。
const MAX_TRANSLATE_CHARS = 200_000;

export type ExtractedPdfPages = {
  title: string;
  /** ページごとの抽出テキスト（チャンク分割の境界に使う） */
  pages: string[];
  pageCount: number;
  /** 上限で途中打ち切りした場合 true */
  truncated: boolean;
};

/**
 * PDF Blob を「ページ単位のテキスト配列」として抽出する。
 * 翻訳取り込みでチャンク分割するために使う（ページ境界を自然な区切りにする）。
 * extractPdfText とは別関数にして既存経路を壊さない。
 */
export async function extractPdfPages(blob: Blob): Promise<ExtractedPdfPages> {
  const buffer = await blob.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), ...PDFJS_DOC_OPTIONS }).promise;

  const pageCount = doc.numPages;
  const pages: string[] = [];
  let total = 0;
  let pagesRead = 0;

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .filter(Boolean)
      .join(" ")
      .trim();
    pages.push(pageText);
    total += pageText.length;
    pagesRead = i;
    if (total > MAX_TRANSLATE_CHARS) break;
  }

  const truncated = pagesRead < pageCount;

  let title = "";
  try {
    const meta = await doc.getMetadata();
    const info = meta?.info as { Title?: string } | undefined;
    title = info?.Title?.trim() ?? "";
  } catch {
    // メタなし PDF はタイトル空のまま
  }

  return { title, pages, pageCount, truncated };
}
