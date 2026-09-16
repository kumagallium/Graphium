// 出典照合（Source check, v1） — サーバー POST /api/wiki/check-sources のクライアント呼び出し。
//
// モデルは wikiHeaders("chatSynthesis") 相当（判断はチャットモデル。点検フル・トピック統合と
// 同じ流儀 — src/features/wiki/wiki-service.ts の wikiHeaders/wikiBodyModel を直接 import
// できない（export されていない）ため、World-grounding の llm-fallback.ts と同じ形で複製する）。

import { apiBase, isTauri } from "../../lib/platform";
import { getChatSynthesisLLMModel, getChatSynthesisModelName } from "../settings/store";
import { aiErrorFromResponse } from "../../lib/ai-error";
import type { SourceCheckSourceKind, SourceCheckVerdict } from "../../lib/document-types";

export type CheckSourcesApiClaim = {
  id: string;
  title: string;
  body: string;
};

export type CheckSourcesApiSource = {
  id: string;
  kind: SourceCheckSourceKind;
  title?: string;
  text: string;
};

export type CheckSourcesApiResultItem = {
  claimId: string;
  verdict: Exclude<SourceCheckVerdict, "source-missing">;
  rationale: string;
  quote?: string;
};

export type CheckSourcesApiResult = {
  results: CheckSourcesApiResultItem[];
  model: string;
};

/** サーバーが degrade（モデル未登録 / API 呼び出し失敗）で { result: null, ... } を返したとき */
export class SourceCheckDegradedError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "SourceCheckDegradedError";
    this.code = code;
  }
}

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getChatSynthesisLLMModel();
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
 * 出典 1 件 + それに依拠する知見群を 1 回の呼び出しで判定する。
 *
 * degrade（モデル未登録・LLM 呼び出し失敗）のときは SourceCheckDegradedError を投げる
 * （world-grounding の { result: null, code } 応答と同じ精神。呼び出し側 runSourceCheck は
 * これを「判定できなかった」として run 全体を中断する — 誤った verdict を書き込まないため）。
 */
export async function callCheckSourcesApi(
  source: CheckSourcesApiSource,
  claims: CheckSourcesApiClaim[],
  language: string,
): Promise<CheckSourcesApiResult> {
  const modelName = getChatSynthesisModelName();
  const res = await fetch(`${apiBase()}/wiki/check-sources`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      source,
      claims,
      language,
      ...(modelName ? { model: modelName } : {}),
    }),
  });

  if (!res.ok) {
    throw await aiErrorFromResponse(res, `Source check failed (${res.status})`);
  }

  const json = (await res.json()) as {
    result: CheckSourcesApiResult | null;
    error?: string;
    code?: string;
  };
  if (!json.result) {
    throw new SourceCheckDegradedError(json.error ?? "source check degraded", json.code);
  }
  return json.result;
}
