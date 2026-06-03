// Graphium ビルトインバックエンド API クライアント
// /api/* エンドポイントを呼び出して AI 機能を提供する

import { apiBase, isTauri } from "../../lib/platform";
import { getEnabledMcpServers, getDefaultLLMModel, getChatSynthesisLLMModel, getChatSynthesisModelName } from "../settings/store";

/**
 * Registry URL・LLM API キーが設定されている場合はヘッダーに含める。
 * mode="chat" のとき、AI チャット用のモデル（Chat & Synthesis モデル、未設定なら default）の
 * 認証情報を送る。インフラ系（fetchModels / fetchProfiles）は default のみで十分。
 */
function apiHeaders(
  mode: "default" | "chat" = "default",
  extra?: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };

  // MCP サーバー供給源（stdio / remote / registry）を 1 本のヘッダーで送る。
  // registry エントリはバックエンドが fetchRegistryServers で展開する
  // （旧来の専用 X-Registry-URL ヘッダーは廃止し、ここに統合した）。
  // id を含めるのはバックエンドの接続プールのキーに使うため（編集時に差し替え）。
  const mcpServers = getEnabledMcpServers();
  if (mcpServers.length > 0) {
    h["X-MCP-Servers"] = JSON.stringify(
      mcpServers.map((s) =>
        s.type === "stdio"
          ? { id: s.id, type: "stdio", name: s.name, command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }
          : s.type === "registry"
            ? { id: s.id, type: "registry", name: s.name, url: s.url, ...(s.apiKey ? { apiKey: s.apiKey } : {}) }
            : { id: s.id, type: "remote", name: s.name, url: s.url, transport: s.transport, ...(s.apiKey ? { apiKey: s.apiKey } : {}) },
      ),
    );
  }

  // Web モード（非 Tauri）: クライアント保持の API キーをヘッダーで送信
  if (!isTauri()) {
    const model = mode === "chat" ? getChatSynthesisLLMModel() : getDefaultLLMModel();
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

export type AgentChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentRunRequest = {
  message: string;
  /** 会話履歴（最新の user メッセージを含む完全な配列）。指定時は messages が優先される。 */
  messages?: AgentChatMessage[];
  session_id?: string;
  custom_instructions?: string;
  server_names?: string[];
  disabled_tools?: string[];
  /** Wiki Retriever が検索したコンテキスト */
  wiki_context?: string;
  /** 構造化出力用のシステムプロンプトに使う言語（"en" | "ja"） */
  language?: string;
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
  /** トークン単価（1M tokens あたり）。AI 使用量ダッシュボードのコスト計算用 */
  rate?: {
    input: number;
    output: number;
    cache_read?: number;
    cache_write?: number;
    /** 単価の通貨。未指定なら "usd" 扱い */
    currency?: "usd" | "jpy";
  };
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


/**
 * AI にセッションタイトル（15文字以内の要約）を生成させる
 */
export async function generateTitle(
  firstMessage: string,
): Promise<string> {
  const res = await fetch(`${apiBase()}/agent/sessions/title`, {
    method: "POST",
    headers: apiHeaders("chat"),
    body: JSON.stringify({
      first_message: firstMessage,
      ...(getChatSynthesisModelName() ? { model: getChatSynthesisModelName() } : {}),
    }),
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
    headers: apiHeaders("chat"),
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent API error ${res.status}: ${text}`);
  }

  return res.json();
}
