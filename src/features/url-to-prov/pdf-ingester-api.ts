// PROV Ingester API クライアント (PDF 経路)
// クライアント側で pdfjs によりテキストを抽出し、サーバー /api/prov/ingest-pdf に投げて
// 構造化済みブロック列を受け取る。

import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { extractPdfText } from "../wiki/pdf-text-extractor";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary } from "./label-vocabulary";
import { t } from "../../i18n";

export type IngestPdfResult = {
  title: string;
  blocks: ProvIngesterBlock[];
  sourceTitle: string;
  sourceFetchedAt: string;
  pageCount: number;
  model: string | null;
  tokenUsage?: { input_tokens: number; output_tokens: number; total_tokens: number };
};

function provHeaders(): Record<string, string> {
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
 * PDF Blob から PROV ラベル付き構造化ブロックを取得する。
 * テキスト抽出はクライアント側で行い、サーバーには抽出済みテキストのみ送る。
 */
export async function ingestPdfToProv(
  blob: Blob,
  fileName: string,
  language: string = "en",
  vocabulary?: ProvVocabulary,
): Promise<IngestPdfResult> {
  const extracted = await extractPdfText(blob);

  if (!extracted.text || extracted.text.length < 50) {
    throw new Error(t("ingest.pdfNoText"));
  }

  // wiki ingester と同じ方針でタイトルを決定:
  // 本文に CJK が混じるのに PDF メタデータの Title が ASCII のみ（LaTeX が埋めた英語タイトルなど）
  // の場合は捨ててファイル名を使う。LLM の出力言語が引きずられるのを防ぐ。
  const bodyHasCJK = /[぀-ヿ一-鿿]/.test(extracted.text);
  const titleIsAsciiOnly =
    extracted.title.length > 0 && /^[\x00-\x7F]+$/.test(extracted.title);
  const fallbackTitle = fileName.replace(/\.pdf$/i, "");
  const title =
    bodyHasCJK && titleIsAsciiOnly
      ? fallbackTitle
      : extracted.title || fallbackTitle;

  const res = await fetch(`${apiBase()}/prov/ingest-pdf`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({
      text: extracted.text,
      title,
      language,
      ...(vocabulary ? { vocabulary } : {}),
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（localizeAiError が i18n 表示する）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  const json = await res.json();
  return { ...json, pageCount: extracted.pageCount };
}
