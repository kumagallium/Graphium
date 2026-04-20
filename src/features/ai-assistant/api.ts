// Graphium ビルトインバックエンド API クライアント
// /api/* エンドポイントを呼び出して AI 機能を提供する

import { apiBase, isTauri } from "../../lib/platform";
import { getRegistryUrl, getDefaultLLMModel } from "../settings/store";

// Registry URL・LLM API キーが設定されている場合はヘッダーに含める
function apiHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };
  const registryUrl = getRegistryUrl();
  if (registryUrl) h["X-Registry-URL"] = registryUrl;

  // Web モード（非 Tauri）: クライアント保持の API キーをヘッダーで送信
  if (!isTauri()) {
    const model = getDefaultLLMModel();
    if (model) {
      h["X-LLM-API-Key"] = JSON.stringify({
        provider: model.provider,
        modelId: model.modelId,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        name: model.name,
      });
    }
  }
  return h;
}

export type AgentRunRequest = {
  message: string;
  session_id?: string;
  profile?: string;
  custom_instructions?: string;
  server_names?: string[];
  disabled_tools?: string[];
  /** Wiki Retriever が検索したコンテキスト */
  wiki_context?: string;
  options?: {
    max_turns?: number;
    model?: string;
  };
};

export type ToolCallRecord = {
  tool_name: string;
  server: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
};

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type AgentRunResponse = {
  session_id: string;
  message: string;
  tool_calls: ToolCallRecord[];
  provenance_id: string | null;
  token_usage: TokenUsage;
  model: string | null;
};

export type ModelInfo = {
  name: string;
  provider: string;
  model_id: string;
  api_base: string;
  supports_function_calling: boolean;
  id: string;
};

export type ModelsResponse = {
  models: ModelInfo[];
  default: string;
};

/**
 * 登録済みモデル一覧を取得する
 */
export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${apiBase()}/models`, { headers: apiHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }
  return res.json();
}

export type ProfileInfo = {
  id: string;
  name: string;
  description: string;
};

export type ProfilesResponse = {
  profiles: ProfileInfo[];
};

/**
 * プロファイル一覧を取得する
 */
export async function fetchProfiles(): Promise<ProfilesResponse> {
  const res = await fetch(`${apiBase()}/profiles`, { headers: apiHeaders() });
  if (!res.ok) {
    throw new Error(`Failed to fetch profiles: ${res.status}`);
  }
  return res.json();
}

/**
 * AI にセッションタイトル（15文字以内の要約）を生成させる
 */
export async function generateTitle(
  firstMessage: string,
): Promise<string> {
  const res = await fetch(`${apiBase()}/agent/sessions/title`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ first_message: firstMessage }),
  });

  if (!res.ok) {
    // フォールバック: 先頭25文字
    return firstMessage.slice(0, 25) + (firstMessage.length > 25 ? "…" : "");
  }

  const data = await res.json();
  // Markdown 修飾子・余分な記号・末尾ゴミを除去
  return (data.title as string)
    .replace(/\*+/g, "")
    .replace(/^#+\s*/, "")
    .replace(/^['"""「」『』]+|['"""「」『』]+$/g, "")
    .replace(/\s*[|｜].*$/, "")
    .replace(/\.{2,}$/, "")
    .trim();
}

/**
 * AI エージェントにメッセージを送信し、回答を取得する
 */
export async function runAgent(
  req: AgentRunRequest,
  signal?: AbortSignal,
): Promise<AgentRunResponse> {
  const res = await fetch(`${apiBase()}/agent/run`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent API error ${res.status}: ${text}`);
  }

  return res.json();
}
