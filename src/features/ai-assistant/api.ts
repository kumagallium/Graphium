// Graphium ビルトインバックエンド API クライアント
// /api/* エンドポイントを呼び出して AI 機能を提供する

import { apiBase, isTauri } from "../../lib/platform";
import type { GroundingScope } from "../../lib/grounding-scope";
import { aiErrorFromResponse } from "../../lib/ai-error";
import { getEnabledMcpServers, getDefaultLLMModel, getChatSynthesisLLMModel, getChatSynthesisModelName } from "../settings/store";

/**
 * Registry URL・LLM API キーが設定されている場合はヘッダーに含める。
 * mode="chat" のとき、AI チャット用のモデル（Chat & Synthesis モデル、未設定なら default）の
 * 認証情報を送る。インフラ系（fetchModels / fetchProfiles）は default のみで十分。
 */
// 注意: ここで送るカスタムヘッダーを追加・変更したら、server/app.ts の cors
// allowHeaders にも必ず追加すること。漏れると Tauri 版（tauri:// → 127.0.0.1 の
// cross-origin）で preflight が失敗し、そのヘッダーが付く全リクエストが落ちる
// （server/app.test.ts の回帰テストが検知する）。
function apiHeaders(
  mode: "default" | "chat" = "default",
  extra?: Record<string, string>,
): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", ...extra };

  // 直接登録した MCP サーバー（stdio / remote）を 1 本のヘッダーで送る。
  // レジストリから選んだサーバーも具体 URL を持つ remote としてここに含まれる。
  // id を含めるのはバックエンドの接続プールのキーに使うため（編集時に差し替え）。
  const mcpServers = getEnabledMcpServers();
  if (mcpServers.length > 0) {
    h["X-MCP-Servers"] = JSON.stringify(
      mcpServers.map((s) =>
        s.type === "stdio"
          ? { id: s.id, type: "stdio", name: s.name, command: s.command, args: s.args, ...(s.env ? { env: s.env } : {}) }
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
  /** grounding スコープ。"external"（外部参照）のときサーバーが Web 検索の強制指示を注入する */
  grounding_scope?: GroundingScope;
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

/** 検索 MCP（Tavily 等）のツール結果から抽出した web 出典。 */
export type WebSource = { title?: string; url: string };

export type AgentRunResponse = {
  session_id: string;
  message: string;
  tool_calls: ToolCallRecord[];
  /** 検索 MCP 由来の web 出典（内蔵 WebSearch 経路では空）。 */
  web_sources?: WebSource[];
  provenance_id: string | null;
  token_usage: TokenUsage;
  model: string | null;
  /**
   * 接続できなかった MCP サーバー。空でなくてもチャット自体は成功している
   * （動くサーバーのツールだけで走る）。以前はサーバー側の console.warn 止まりで
   * ユーザーには「ツールが出てこない」としか見えなかったので、ここに載せて伝える。
   */
  mcp_errors?: { name: string; target: string; message: string }[];
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
    // { error, code } を code 付き Error に変換（localizeAiError が i18n 表示する）
    throw await aiErrorFromResponse(res, `Agent API error ${res.status}`);
  }

  return res.json();
}
