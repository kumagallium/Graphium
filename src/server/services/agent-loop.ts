// エージェントループ
// Vercel AI SDK の generateText + stepCountIs でマルチステップ実行する

import { generateText, stepCountIs, type ModelMessage, type LanguageModel } from "ai";
import type { ModelConfig } from "../config/models.js";
import { recordUsage, extractTokenFields } from "./llm-usage.js";
import { runTextToolsLoop } from "./agent-loop-text-tools.js";

export type AgentRunParams = {
  model: LanguageModel;
  modelId: string;
  systemPrompt: string;
  messages: ModelMessage[];
  tools?: Record<string, unknown>;
  maxSteps?: number;
  /** AI 使用量ログ用の機能識別子。"wiki.ingest" 等。未指定なら計測スキップ。 */
  feature?: string;
  /** モデル単価特定用の ModelConfig。指定があれば provider / rate を記録に焼き込む。 */
  modelConfig?: ModelConfig;
  /** サンプリング温度。0 で実行間のブレを抑える（翻訳など決定性が欲しい用途向け）。未指定はモデル既定。 */
  temperature?: number;
};

export type AgentRunResult = {
  message: string;
  toolCalls: ToolCallRecord[];
  tokenUsage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    reasoning_tokens?: number;
  };
  model: string | null;
};

export type ToolCallRecord = {
  tool_name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  duration_ms: number;
};

/**
 * エージェントループを実行して最終テキストを返す
 *
 * provider が "openai-compatible" でかつツールが渡されている場合は、ネイティブの function calling
 * が endpoint 側で実装されていないモデル（sakura ai engine / gpt-oss-120b など）に対応するため、
 * tools 定義を system prompt に埋め込んで `<tool_call>...</tool_call>` ベースのテキスト応答を
 * パースする fallback ループに切り替える。
 */
export async function runAgentLoop(params: AgentRunParams): Promise<AgentRunResult> {
  const { model, modelId, systemPrompt, messages, tools, maxSteps = 10, feature, modelConfig, temperature } = params;

  const useTextToolsLoop =
    modelConfig?.provider === "openai-compatible" &&
    !!tools &&
    Object.keys(tools).length > 0;
  if (useTextToolsLoop) {
    return runTextToolsLoop(params);
  }

  const startedAt = Date.now();
  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    // tools が空の場合は undefined にする
    ...(tools && Object.keys(tools).length > 0 ? { tools: tools as any } : {}),
    stopWhen: stepCountIs(maxSteps),
  });
  const durationMs = Date.now() - startedAt;

  // ツール呼び出しの記録を収集
  const toolCalls: ToolCallRecord[] = [];
  for (const step of result.steps) {
    for (const tc of step.toolCalls ?? []) {
      toolCalls.push({
        tool_name: tc.toolName,
        input: tc.input as Record<string, unknown>,
        output: {},
        duration_ms: 0,
      });
    }
  }

  const tokens = extractTokenFields(result.usage);

  // 使用量記録（feature 指定時のみ）
  if (feature) {
    recordUsage({
      ts: new Date().toISOString(),
      feature,
      provider: modelConfig?.provider ?? "unknown",
      modelId,
      modelConfigId: modelConfig?.id,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      cacheWriteTokens: tokens.cacheWriteTokens,
      reasoningTokens: tokens.reasoningTokens,
      totalTokens: tokens.totalTokens,
      durationMs,
      rateSnapshot: modelConfig?.rate,
    });
  }

  return {
    message: result.text,
    toolCalls,
    tokenUsage: {
      input_tokens: tokens.inputTokens,
      output_tokens: tokens.outputTokens,
      total_tokens: tokens.totalTokens,
      cache_read_tokens: tokens.cacheReadTokens,
      cache_write_tokens: tokens.cacheWriteTokens,
      reasoning_tokens: tokens.reasoningTokens,
    },
    model: modelId,
  };
}
