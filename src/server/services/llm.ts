// Vercel AI SDK マルチプロバイダー LLM ラッパー
// ModelConfig に基づいて適切なプロバイダーインスタンスを生成する

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import type { ModelConfig } from "../config/models.js";

/**
 * ModelConfig からプロバイダーインスタンスを生成する
 */
export function createModel(config: ModelConfig): LanguageModel {
  switch (config.provider) {
    case "anthropic": {
      // `createAnthropic` に baseURL を渡さないと SDK は環境変数 `ANTHROPIC_BASE_URL` を
      // 読み、最終フォールバックで `https://api.anthropic.com/v1` を使う。
      // 環境に `ANTHROPIC_BASE_URL=https://api.anthropic.com`（/v1 なし）が
      // セットされていると、SDK は `${env}/messages` を叩いて 404 を返す。
      // また `fetchAnthropicModels` は historically apiBase に `/v1` を付けない形で
      // 保存していたケースがあるので、ユーザー指定値も末尾を正規化する。
      // → 環境変数の影響を断ち切るため、常に明示的に baseURL を渡す。
      const ANTHROPIC_DEFAULT_BASE = "https://api.anthropic.com/v1";
      const normalizedBase = (() => {
        if (!config.apiBase) return ANTHROPIC_DEFAULT_BASE;
        const trimmed = config.apiBase.replace(/\/$/, "");
        return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
      })();
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: normalizedBase,
      });
      return provider(config.modelId);
    }
    case "openai": {
      // apiBase が設定されている場合は openai-compatible を使う
      // （@ai-sdk/openai は baseURL でカスタムエンドポイントを正しく扱えない場合がある）
      if (config.apiBase) {
        const provider = createOpenAICompatible({
          name: config.name,
          baseURL: config.apiBase,
          apiKey: config.apiKey,
        });
        return provider(config.modelId);
      }
      const provider = createOpenAI({ apiKey: config.apiKey });
      return provider(config.modelId);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({ apiKey: config.apiKey });
      return provider(config.modelId);
    }
    case "openai-compatible": {
      if (!config.apiBase) {
        throw new Error("openai-compatible プロバイダーには apiBase が必要です");
      }
      const provider = createOpenAICompatible({
        name: config.name,
        baseURL: config.apiBase,
        apiKey: config.apiKey,
      });
      return provider(config.modelId);
    }
    default:
      throw new Error(`未知のプロバイダー: ${config.provider}`);
  }
}

/**
 * API キーでプロバイダーのモデル一覧を取得する
 * (Crucible Agent の POST /models/available と同等)
 */
export async function fetchAvailableModels(
  provider: string,
  apiKey: string,
  apiBase?: string,
): Promise<string[]> {
  const base = apiBase || DEFAULT_API_BASE[provider];
  if (!base) {
    throw new Error(`${provider} には API Base URL が必要です`);
  }

  const fetcher = PROVIDER_FETCHER[provider] ?? fetchOpenAIModels;
  return fetcher(base, apiKey);
}

const DEFAULT_API_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com",
  groq: "https://api.groq.com/openai/v1",
};

type ModelFetcher = (apiBase: string, apiKey: string) => Promise<string[]>;

const PROVIDER_FETCHER: Record<string, ModelFetcher> = {
  anthropic: fetchAnthropicModels,
  google: fetchGoogleModels,
  // openai, groq, ollama は OpenAI 互換
};

async function fetchOpenAIModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/models`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(await formatApiError(res));
  const data = (await res.json()) as {
    data?: { id: string }[];
  };
  return (data.data ?? []).map((m) => m.id).sort();
}

async function fetchAnthropicModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/v1/models`;
  const all: string[] = [];
  const params = new URLSearchParams({ limit: "100" });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${url}?${params}`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });
    if (!res.ok) throw new Error(await formatApiError(res));
    const data = (await res.json()) as {
      data?: { id: string }[];
      has_more?: boolean;
      last_id?: string;
    };
    all.push(...(data.data ?? []).map((m) => m.id));
    if (!data.has_more) break;
    params.set("after_id", data.last_id ?? "");
  }
  return all.sort();
}

async function fetchGoogleModels(
  apiBase: string,
  apiKey: string,
): Promise<string[]> {
  const url = `${apiBase.replace(/\/$/, "")}/v1beta/models`;
  const all: string[] = [];
  const params = new URLSearchParams({ key: apiKey, pageSize: "100" });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${url}?${params}`);
    if (!res.ok) throw new Error(await formatApiError(res));
    const data = (await res.json()) as {
      models?: {
        name: string;
        supportedGenerationMethods?: string[];
      }[];
      nextPageToken?: string;
    };
    for (const m of data.models ?? []) {
      if (!m.supportedGenerationMethods?.includes("generateContent")) continue;
      const name = m.name.startsWith("models/")
        ? m.name.slice("models/".length)
        : m.name;
      if (name) all.push(name);
    }
    if (!data.nextPageToken) break;
    params.set("pageToken", data.nextPageToken);
  }
  return all.sort();
}

async function formatApiError(res: Response): Promise<string> {
  if (res.status === 401) return "API キーが無効です";
  if (res.status === 403) return "API キーに権限がありません";
  const text = await res.text().catch(() => "");
  return `プロバイダー API エラー (${res.status}): ${text.slice(0, 200)}`;
}
