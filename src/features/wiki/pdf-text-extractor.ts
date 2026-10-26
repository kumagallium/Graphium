// PDF からテキストを抽出するクライアント側ヘルパー
// react-pdf 同梱の pdfjs を流用する（追加依存なし）

import { pdfjs } from "react-pdf";
import { PDFJS_DOC_OPTIONS } from "../../lib/pdfjs-config";

// 1 回の呼び出しで全文を渡す経路の上限と打ち切り注記は、Node（MCP）からも使えるよう
// source-ingest-input.ts に置いている（このファイルは react-pdf に依存するブラウザ専用）。
import { capForSingleCall, PDF_TRUNCATION_MARKER, SINGLE_CALL_MAX_CHARS } from "./source-ingest-input";
export { capForSingleCall, PDF_TRUNCATION_MARKER, SINGLE_CALL_MAX_CHARS };

export type ExtractedPdf = {
  title: string;
  text: string;
  pageCount: number;
  /** pageStarts[i] = 返す text 上で (i+1) ページ目のテキストが始まる文字オフセット。読んだページ数ぶん。
   *  出典照合（quote-match.ts の resolveQuoteLocation）がページ番号を解くのに使う。 */
  pageStarts?: number[];
};

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

/**
 * PDF Blob からテキスト全体とメタタイトルを抽出する。
 * 打ち切りはしない（全ページを読んで全文を返す） — 窓分割で読む消費者が全文を必要とするため。
 * 1 回の呼び出しで全文を LLM に渡す経路は capForSingleCall で別途上限を掛けること。
 */
export async function extractPdfText(blob: Blob, signal?: AbortSignal): Promise<ExtractedPdf> {
  throwIfAborted(signal);
  const buffer = await blob.arrayBuffer();
  throwIfAborted(signal);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), ...PDFJS_DOC_OPTIONS });
  const cancelLoading = () => { void loadingTask.destroy(); };
  signal?.addEventListener("abort", cancelLoading, { once: true });

  try {
    const doc = await loadingTask.promise;
    throwIfAborted(signal);
    const pageCount = doc.numPages;
    const parts: string[] = [];

    for (let i = 1; i <= pageCount; i++) {
      throwIfAborted(signal);
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      throwIfAborted(signal);
      const pageText = content.items
        .map((item) => ("str" in item ? (item as { str: string }).str : ""))
        .filter(Boolean)
        .join(" ");
      parts.push(pageText);
    }

    // parts.join("\n\n") 前の、各ページ開始オフセットを先に出しておく（join は
    // ページ間に "\n\n"（2 文字）を挟むだけなので、結合後のオフセットも機械的に求まる）。
    // 打ち切りをしなくなったので、全ページぶんがそのまま残る。
    const rawPageStarts: number[] = [];
    {
      let offset = 0;
      for (let i = 0; i < parts.length; i++) {
        rawPageStarts.push(offset);
        offset += parts[i].length + (i < parts.length - 1 ? 2 : 0);
      }
    }

    const joined = parts.join("\n\n");
    const text = joined.trim();
    // 先頭 trim で削れた文字数だけ、各ページ開始オフセットを引く。
    const leadingTrimmed = joined.length - joined.trimStart().length;
    const pageStarts = rawPageStarts.map((s) => Math.max(0, s - leadingTrimmed));

    let title = "";
    try {
      const meta = await doc.getMetadata();
      const info = meta?.info as { Title?: string } | undefined;
      title = info?.Title?.trim() ?? "";
    } catch {
      // メタなし PDF はタイトル空のまま
    }

    return { title, text, pageCount, pageStarts };
  } finally {
    signal?.removeEventListener("abort", cancelLoading);
  }
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
