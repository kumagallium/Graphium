// World-model grounding LLM fallback client (Phase 2 / PR 2B + 2C).
//
// サーバー endpoint POST /api/world-grounding/check を呼び出し、verdict / rationale /
// normalizedClaim / keywords / sources を取得する。
//
// 失敗時は failure ペイロードを返す（facade 側で「verdict なし checkedAt のみ」に degrade）。
//
// PR 2C: domain 引数 と tags 生成を廃止（汎用ノートエディタとして分類問題を持ち込まない）。

import { apiBase, isTauri } from "../../lib/platform";
import {
  getGroundingLLMModel,
  getGroundingModelName,
} from "../settings/store";
import type { GroundingValidityVerdict } from "../../lib/document-types";

export type WorldGroundingModelResult = {
  verdict: GroundingValidityVerdict | null;
  rationale: string;
  normalizedClaim?: string;
  keywords?: string[];
  sources?: { ref: string; url?: string }[];
  /** どのモデルが判定したか（"claude-opus-4-7" など）。`null` の verdict でも記録 */
  model: string;
};

/**
 * LLM fallback が呼ばれなかった/失敗した理由を区別する。
 * - `"no-model"`: groundingModel もデフォルトも未登録 → そもそも呼ばなかった
 * - `"http-error"`: サーバー endpoint が 4xx/5xx で返した
 * - `"network-error"`: fetch 自体が throw した（CORS / 接続不能）
 * - `"server-degrade"`: サーバーが {result: null, error} で degrade した（モデル未登録/API エラー）
 */
export type WorldGroundingFailureReason =
  | "no-model"
  | "http-error"
  | "network-error"
  | "server-degrade";

export type WorldGroundingFailure = {
  reason: WorldGroundingFailureReason;
  message?: string;
};

function buildHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (!isTauri()) {
    const model = getGroundingLLMModel();
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

export type CheckValidityViaModelOptions = {
  language?: string;
};

export type CheckValidityViaModelOutcome =
  | { kind: "ok"; result: WorldGroundingModelResult }
  | { kind: "failure"; failure: WorldGroundingFailure };

/**
 * サーバー endpoint に主張を投げて LLM 判定を取得する。
 * 失敗時は `failure` ペイロードで理由を返し、呼び出し側で UI に出し分けられるようにする。
 */
export async function checkValidityViaModel(
  claimText: string,
  options: CheckValidityViaModelOptions = {},
): Promise<CheckValidityViaModelOutcome> {
  const modelName = getGroundingModelName();
  if (!modelName) {
    return { kind: "failure", failure: { reason: "no-model" } };
  }

  try {
    const res = await fetch(`${apiBase()}/world-grounding/check`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        claimText,
        language: options.language ?? "en",
        model: modelName,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        kind: "failure",
        failure: { reason: "http-error", message: `HTTP ${res.status}: ${text.slice(0, 200)}` },
      };
    }
    const json = (await res.json()) as {
      result: {
        verdict: GroundingValidityVerdict | null;
        rationale: string;
        normalizedClaim?: string;
        keywords?: string[];
        sources?: { ref: string; url?: string }[];
      } | null;
      model?: string;
      error?: string;
    };
    if (!json.result) {
      // サーバーが {result: null, error} で degrade（モデル未登録 / API 失敗）
      return {
        kind: "failure",
        failure: { reason: "server-degrade", message: json.error ?? "unknown server error" },
      };
    }
    return {
      kind: "ok",
      result: {
        verdict: json.result.verdict,
        rationale: json.result.rationale,
        normalizedClaim: json.result.normalizedClaim,
        keywords: json.result.keywords,
        sources: json.result.sources,
        model: json.model ?? modelName,
      },
    };
  } catch (err) {
    console.warn("[world-grounding] LLM fallback fetch failed:", err);
    return {
      kind: "failure",
      failure: {
        reason: "network-error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
