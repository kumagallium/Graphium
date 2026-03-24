// crucible-agent API クライアント
// POST /agent/run を呼び出して AI 回答を取得する

import { getAgentUrl, getAgentApiKey } from "../settings";

// API キー認証ヘッダーを含む共通ヘッダーを生成
function agentHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = getAgentApiKey();
  if (apiKey) h["X-API-Key"] = apiKey;
  return h;
}

export type AgentRunRequest = {
  message: string;
  session_id?: string;
  profile?: string;
  custom_instructions?: string;
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

/**
 * AI にセッションタイトル（15文字以内の要約）を生成させる
 */
export async function generateTitle(
  firstMessage: string,
): Promise<string> {
  const res = await fetch(`${getAgentUrl()}/sessions/title`, {
    method: "POST",
    headers: agentHeaders(),
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
 * crucible-agent にメッセージを送信し、AI 回答を取得する
 */
export async function runAgent(
  req: AgentRunRequest,
  signal?: AbortSignal,
): Promise<AgentRunResponse> {
  const res = await fetch(`${getAgentUrl()}/agent/run`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent API error ${res.status}: ${text}`);
  }

  return res.json();
}
