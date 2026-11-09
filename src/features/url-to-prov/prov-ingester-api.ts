// PROV Ingester API クライアント
// サーバー /api/prov/ingest-url を叩き、構造化済みブロック列を受け取る

import { apiBase, isTauri } from "../../lib/platform";
import { toAsciiJson } from "../../lib/ascii-json";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getPreciseLLMModel, getPreciseModelName } from "../settings/store";
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

export function provHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getPreciseLLMModel(); // 手順の抽出は精密な処理の段
    if (model) {
      h["X-LLM-API-Key"] = toAsciiJson({
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
      ...(getPreciseModelName() ? { model: getPreciseModelName() } : {}),
    }),
  });

  if (!res.ok) {
    // { error, code } を code 付き Error に変換（localizeAiError が i18n 表示する）
    throw await aiErrorFromResponse(res, `Ingest failed (${res.status})`);
  }

  return res.json();
}
