// crucible-agent API クライアント
// POST /agent/run を呼び出して AI 回答を取得する

// crucible-agent のエンドポイント（環境変数 or デフォルト）
const AGENT_BASE_URL =
  import.meta.env.VITE_CRUCIBLE_AGENT_URL ?? "http://10.0.0.3:8090";

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
};

/**
 * AI にセッションタイトル（15文字以内の要約）を生成させる
 */
export async function generateTitle(
  firstMessage: string,
): Promise<string> {
  const res = await fetch(`${AGENT_BASE_URL}/sessions/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
  const res = await fetch(`${AGENT_BASE_URL}/agent/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Agent API error ${res.status}: ${text}`);
  }

  return res.json();
}
