// PROV Ingester API クライアント
// サーバー /api/prov/ingest-url を叩き、構造化済みブロック列を受け取る

import { apiBase, isTauri } from "../../lib/platform";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getDefaultLLMModel, getSelectedModel } from "../settings/store";
import type { ProvIngesterBlock } from "./prov-note-builder";
import type { ProvVocabulary } from "./label-vocabulary";

export type IngestUrlResult = {
  title: string;
  blocks: ProvIngesterBlock[];
  sourceUrl: string;
  sourceTitle?: string;
  sourceFetchedAt: string;
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
 * URL から PROV ラベル付きの構造化ブロックを取得する
 */
export async function ingestUrlToProv(
  url: string,
  language: string = "en",
  vocabulary?: ProvVocabulary,
): Promise<IngestUrlResult> {
  const res = await fetch(`${apiBase()}/prov/ingest-url`, {
    method: "POST",
    headers: provHeaders(),
    body: JSON.stringify({
      url,
      language,
      ...(vocabulary ? { vocabulary } : {}),
      ...(getSelectedModel() ? { model: getSelectedModel() } : {}),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（localizeAiError が i18n 表示する）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  return res.json();
}
