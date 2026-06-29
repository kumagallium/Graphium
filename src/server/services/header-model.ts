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
        rate?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
          currency?: "usd" | "jpy";
        };
      };
      const rate =
        parsed.rate &&
        typeof parsed.rate.input === "number" &&
        typeof parsed.rate.output === "number"
          ? {
              input: parsed.rate.input,
              output: parsed.rate.output,
              cacheRead: parsed.rate.cacheRead,
              cacheWrite: parsed.rate.cacheWrite,
              currency:
                parsed.rate.currency === "jpy" ? ("jpy" as const) : ("usd" as const),
            }
          : undefined;
      return {
        id: "header-injected",
        name: parsed.name || parsed.modelId,
        provider: parsed.provider,
        modelId: parsed.modelId,
        apiKey: parsed.apiKey,
        apiBase: parsed.apiBase ?? null,
        rate,
        createdAt: new Date().toISOString(),
      };
    } catch {
      return undefined;
    }
  }

  // 従来パス: サーバー側のモデル設定（Node モード）
  if (getServerMode() === "vercel") return undefined;

  // modelName 指定があるのに見つからない場合、getDefaultModel()（= 登録配列の先頭）へ
  // 黙ってフォールバックすると、ユーザーが選んだのとは別の provider / 課金モデルで実行され、
  // 意図しない課金や認証エラーにつながる。解決できないことを明示するため undefined を返す
  // （呼び出し側の各ルートが `if (!modelConfig)` で「モデル未登録」エラーに落とす）。
  if (options?.modelName) {
    const found = listModels().find((m) => m.name === options.modelName);
    if (!found) {
      console.warn(
        `[header-model] requested model "${options.modelName}" not found; refusing silent fallback to default model`,
      );
      return undefined;
    }
    return found;
  }
  return getDefaultModel();
}
