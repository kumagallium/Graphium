// X-LLM-API-Key ヘッダーからモデル設定を取得するヘルパー
// Web (Vercel) モードでは、クライアントがヘッダーで API キーを渡す

import type { Context } from "hono";
import type { ModelConfig } from "../config/models.js";
import { getDefaultModel, listModels, getServerMode } from "../config/models.js";

/**
 * リクエストからモデル設定を解決する。
 * 1. X-LLM-API-Key ヘッダーがあればそこからモデル設定を構築
 * 2. なければサーバー側の models.json から取得（Node モード）
 * 3. options.modelName が指定されていれば名前で検索
 */
export function resolveModelConfig(
  c: Context,
  options?: { modelName?: string },
): ModelConfig | undefined {
  // ヘッダーからの API キー注入（Web / Vercel モード）
  const llmHeader = c.req.header("X-LLM-API-Key");
  if (llmHeader) {
    try {
      const parsed = JSON.parse(llmHeader) as {
        provider: string;
        modelId: string;
        apiKey: string;
        apiBase?: string | null;
        name?: string;
      };
      return {
        id: "header-injected",
        name: parsed.name || parsed.modelId,
        provider: parsed.provider,
        modelId: parsed.modelId,
        apiKey: parsed.apiKey,
        apiBase: parsed.apiBase ?? null,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  // 従来パス: サーバー側のモデル設定（Node モード）
  if (getServerMode() === "vercel") return undefined;

  let config = getDefaultModel();
  if (options?.modelName) {
    const models = listModels();
    config = models.find((m) => m.name === options.modelName) ?? config;
  }
  return config;
}
