// PDF 全文翻訳取り込み（クライアント側）
//
// PDF を「原文の構成のまま目的言語へ全文翻訳した 1 ノート」に変換する。
// 要約・構造化（wiki / prov ingester）とは別経路。
//
// フロー:
//   1. pdfjs でページ単位テキストを抽出（extractPdfPages）
//   2. ページ境界でチャンク分割（1 チャンク ≒ TRANSLATE_CHUNK_CHARS）
//   3. 各チャンクをサーバー /api/translate に投げて Markdown を得る（順次）
//   4. Markdown を連結し、BlockNote ブロックへ変換
//   5. GraphiumDocument を組み立てて返す（保存は呼び出し側）

import { BlockNoteEditor, BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from "@blocknote/core";
import { apiBase, isTauri } from "../../lib/platform";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import { extractPdfPages } from "../wiki/pdf-text-extractor";
import type { GraphiumDocument } from "../../lib/document-types";
import { LATEST_DOCUMENT_VERSION } from "../../lib/document-migration";

// 1 チャンクあたりの目安文字数。全文翻訳は出力が入力とほぼ同量になるため、
// 1 回の LLM 応答に収まるサイズに分割する。ページ境界優先でまとめる。
const TRANSLATE_CHUNK_CHARS = 6_000;

export type TranslateProgress = (done: number, total: number) => void;

type TranslateChunkResponse = {
  markdown?: string;
  model?: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  error?: string;
};

function translateHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getDefaultLLMModel();
    if (model) {
      h["X-LLM-API-Key"] = JSON.stringify({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
        rate: model.rate,
      });
    }
  }
  return h;
}

/**
 * ページ配列をチャンクへまとめる。
 * ページ境界を優先しつつ、1 チャンクが TRANSLATE_CHUNK_CHARS を大きく超えないようにする。
 * 1 ページ単体が上限を超える場合はそのページを 1 チャンクとして扱う。
 */
function chunkPages(pages: string[], maxChars = TRANSLATE_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let buf = "";
  for (const raw of pages) {
    const page = raw.trim();
    if (!page) continue;
    if (buf && buf.length + page.length + 2 > maxChars) {
      chunks.push(buf);
      buf = "";
    }
    buf = buf ? `${buf}\n\n${page}` : page;
    if (buf.length >= maxChars) {
      chunks.push(buf);
      buf = "";
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

async function translateChunk(
  text: string,
  language: string,
  partLabel: string,
): Promise<TranslateChunkResponse> {
  const res = await fetch(`${apiBase()}/translate`, {
    method: "POST",
    headers: translateHeaders(),
    body: JSON.stringify({
      text,
      language,
      partLabel,
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Translate failed (${res.status})`);
  }
  return (await res.json()) as TranslateChunkResponse;
}

/** Markdown 冒頭の最初の見出しをノートタイトル候補として取り出す */
function firstHeading(markdown: string): string | null {
  const m = markdown.match(/^#{1,3}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

/** Markdown → BlockNote ブロック配列（markdown-import と同じ ephemeral editor 方式） */
function markdownToBlocks(markdown: string): any[] {
  const schema = BlockNoteSchema.create({
    blockSpecs: defaultBlockSpecs,
    styleSpecs: defaultStyleSpecs,
  });
  const editor = BlockNoteEditor.create({ schema });
  return editor.tryParseMarkdownToBlocks(markdown) as any[];
}

/** 出典表示用の先頭ブロック（PDF ファイル名のテキスト表示） */
function buildSourceHeaderBlock(sourceName: string): any {
  return {
    id: crypto.randomUUID(),
    type: "paragraph",
    props: { textColor: "default", backgroundColor: "default", textAlignment: "left" },
    content: [
      { type: "text", text: "Source: ", styles: { bold: true } },
      { type: "text", text: sourceName, styles: {} },
    ],
    children: [],
  };
}

export type TranslatePdfResult = {
  doc: GraphiumDocument;
  /** 上限で途中打ち切りした場合 true */
  truncated: boolean;
  chunkCount: number;
};

/**
 * PDF Blob を「原文構成のまま目的言語へ全文翻訳した GraphiumDocument」に変換する。
 *
 * @param blob       PDF の Blob
 * @param fileName   元ファイル名（タイトル・出典表示のフォールバック）
 * @param language   目的言語コード（UI ロケール: "ja" / "en" など）
 * @param sourcePdfFileId メディアインデックス上の PDF fileId（出典リンク用）
 * @param onProgress チャンク翻訳の進捗コールバック
 */
export async function translatePdfToNote(
  blob: Blob,
  fileName: string,
  language: string,
  sourcePdfFileId: string | undefined,
  onProgress?: TranslateProgress,
): Promise<TranslatePdfResult> {
  const extracted = await extractPdfPages(blob);
  const chunks = chunkPages(extracted.pages);

  if (chunks.length === 0) {
    throw new Error("PDF から十分なテキストを抽出できませんでした（スキャン PDF など？）");
  }

  const markdownParts: string[] = [];
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;

  onProgress?.(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    const partLabel = `part ${i + 1}/${chunks.length}`;
    const result = await translateChunk(chunks[i], language, partLabel);
    if (result.markdown) markdownParts.push(result.markdown.trim());
    if (result.model) model = result.model;
    if (result.tokenUsage) {
      inputTokens += result.tokenUsage.input_tokens ?? 0;
      outputTokens += result.tokenUsage.output_tokens ?? 0;
    }
    onProgress?.(i + 1, chunks.length);
  }

  const markdown = markdownParts.join("\n\n");
  if (!markdown.trim()) {
    throw new Error("翻訳結果が空でした。");
  }

  const fallbackTitle = fileName.replace(/\.pdf$/i, "");
  const title = firstHeading(markdown) || fallbackTitle;

  const blocks = markdownToBlocks(markdown);
  const noteBlocks = [buildSourceHeaderBlock(extracted.title || fallbackTitle), ...blocks];

  const now = new Date().toISOString();
  const doc: GraphiumDocument = {
    version: LATEST_DOCUMENT_VERSION,
    title,
    pages: [
      {
        id: "main",
        title,
        blocks: noteBlocks,
        labels: {},
        provLinks: [],
        knowledgeLinks: [],
      },
    ],
    sourcePdfFileId,
    sourcePdfName: extracted.title || fallbackTitle,
    sourceTitle: extracted.title || fallbackTitle,
    sourceFetchedAt: now,
    generatedBy: {
      agent: "pdf-translator",
      sessionId: sourcePdfFileId ? `pdf:${sourcePdfFileId}` : `pdf:${fileName}`,
      model: model ?? undefined,
      tokenUsage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    },
    createdAt: now,
    modifiedAt: now,
  };

  return { doc, truncated: extracted.truncated, chunkCount: chunks.length };
}
