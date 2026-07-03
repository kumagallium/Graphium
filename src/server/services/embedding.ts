// Embedding 生成サービス
// Vercel AI SDK でテキストの embedding ベクトルを生成する

import type { ModelConfig } from "../config/models.js";
import { recordUsage } from "./llm-usage.js";
import { CodedError } from "../../lib/ai-error-codes.js";

export type EmbeddingResult = {
  vectors: number[][];
  modelVersion: string;
  tokens?: number;
};

/**
 * テキスト配列から embedding ベクトルを生成する
 * OpenAI / OpenAI 互換のプロバイダーのみ対応
 */
export async function generateEmbeddings(
  texts: string[],
  config: ModelConfig,
): Promise<EmbeddingResult> {
  // Vercel AI SDK の embedMany を使用
  const { embedMany } = await import("ai");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");

  // 登録されたモデルの modelId をそのまま使う（text-embedding-3-small 等をハードコードしない）
  const embeddingModelId = config.modelId;

  let embeddingModel;
  if (config.provider === "openai") {
    const provider = config.apiBase
      ? createOpenAICompatible({
          name: config.name,
          baseURL: config.apiBase,
          apiKey: config.apiKey,
        })
      : createOpenAI({ apiKey: config.apiKey });
    embeddingModel = provider.textEmbeddingModel(embeddingModelId);
  } else if (config.provider === "openai-compatible") {
    if (!config.apiBase) throw new Error("apiBase is required for openai-compatible providers");
    const provider = createOpenAICompatible({
      name: config.name,
      baseURL: config.apiBase,
      apiKey: config.apiKey,
    });
    embeddingModel = provider.textEmbeddingModel(embeddingModelId);
  } else {
    // code 付きで throw し、wiki /embed ルートの catch（errorBody）が JSON へ通す
    throw new CodedError(
      `Embedding requires an OpenAI or OpenAI-compatible provider (current: ${config.provider}). ` +
      "Add an OpenAI-compatible model in Settings → AI Setup.",
      "EMBEDDING_MODEL_UNSUPPORTED",
    );
  }

  const startedAt = Date.now();
  const result = await embedMany({
    model: embeddingModel,
    values: texts,
  });
  const durationMs = Date.now() - startedAt;

  const tokens = result.usage?.tokens ?? 0;
  recordUsage({
    ts: new Date().toISOString(),
    feature: "embedding",
    provider: config.provider,
    modelId: embeddingModelId,
    modelConfigId: config.id,
    inputTokens: tokens,
    outputTokens: 0,
    totalTokens: tokens,
    durationMs,
    rateSnapshot: config.rate,
  });

  return {
    vectors: result.embeddings,
    modelVersion: embeddingModelId,
    tokens,
  };
}
