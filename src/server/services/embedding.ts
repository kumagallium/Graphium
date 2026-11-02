// Embedding 生成サービス
// Vercel AI SDK でテキストの embedding ベクトルを生成する

import type { ModelConfig } from "../config/models.js";
import { recordUsage } from "./llm-usage.js";
import { CodedError } from "../../lib/ai-error-codes.js";

export type EmbeddingResult = {
  vectors: number[][];
  modelVersion: string;
  tokens?: number;
  /** 提供者に弾かれて短く切り詰めて埋め込んだ文の数 */
  truncated?: number;
};

/**
 * 1 回の呼び出しに載せる文の上限。
 * Sakura AI Engine の multilingual-e5-large は 1 リクエストに 16 件を超える文を入れると
 * 後ろの文のベクトルが崩れる（同じ文を 1 件ずつ埋め込んだベクトルとの cosine が
 * 16 件まで 0.99、33〜48 件目 0.85、49〜64 件目 0.73。2026-10-27 実測、
 * Crucible experiments/2026-10-27-local-embedding-eval）。崩れても HTTP は 200 で返るので、
 * 呼び出し側で分けるしかない。重複判定は候補を全件まとめて送るのでこれに当たっていた
 */
export const EMBED_BATCH_SIZE = 16;

/**
 * 提供者に弾かれた文を切り詰めて送り直すときの長さ（文字）の段。
 * 同じ Sakura の e5-large は 512 トークン超の入力を切り詰めずに 500 Bad Request で返す。
 * ノートの全節を 1 リクエストで送っているので、長い節が 1 つあるとノート全体が
 * ベクトル無しになっていた。弾かれたバッチだけ 1 文ずつ、全文 → 500 → 250 文字で送り直す。
 * 日本語の密な文（@ メンション入り）は 860 文字で 512 トークンを超えた例があるので 500 を上限にする
 */
export const EMBED_FALLBACK_CHARS: readonly number[] = [500, 250];

export type EmbedBatchFn = (texts: string[]) => Promise<{ vectors: number[][]; tokens: number }>;

/**
 * 文を EMBED_BATCH_SIZE ずつ embedFn に渡し、弾かれたバッチは 1 文ずつ切り詰めて送り直す。
 * 順序は入力どおり。どの段でも通らない文があれば、その失敗をそのまま投げる
 * （認証切れなど長さと無関係の失敗は、最初の文の 3 段で止まる）
 */
export async function embedInBatches(
  texts: string[],
  embedFn: EmbedBatchFn,
): Promise<{ vectors: number[][]; tokens: number; truncated: number }> {
  const vectors: number[][] = [];
  let tokens = 0;
  let truncated = 0;
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const r = await embedFn(batch);
      vectors.push(...r.vectors);
      tokens += r.tokens;
      continue;
    } catch {
      // バッチのどれかが弾かれた。1 文ずつ、長さを段階的に落として送り直す
    }
    for (const text of batch) {
      let lastErr: unknown;
      let done = false;
      for (const limit of [text.length, ...EMBED_FALLBACK_CHARS.filter((n) => n < text.length)]) {
        try {
          const r = await embedFn([text.slice(0, limit)]);
          vectors.push(r.vectors[0]);
          tokens += r.tokens;
          if (limit < text.length) truncated++;
          done = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!done) throw lastErr;
    }
  }
  return { vectors, tokens, truncated };
}

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
      "Add an OpenAI-compatible model in Settings → AI.",
      "EMBEDDING_MODEL_UNSUPPORTED",
    );
  }

  const startedAt = Date.now();
  const model = embeddingModel;
  const { vectors, tokens, truncated } = await embedInBatches(texts, async (values) => {
    const result = await embedMany({ model, values });
    return { vectors: result.embeddings, tokens: result.usage?.tokens ?? 0 };
  });
  const durationMs = Date.now() - startedAt;
  if (truncated > 0) {
    console.warn(`[embedding] ${truncated} of ${texts.length} texts were rejected at full length and embedded truncated (${config.name})`);
  }

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
    vectors,
    modelVersion: embeddingModelId,
    tokens,
    truncated,
  };
}
