// エージェントループ
// Vercel AI SDK の generateText + stepCountIs でマルチステップ実行する

import { generateText, stepCountIs, type ModelMessage, type LanguageModel } from "ai";
import type { ModelConfig } from "../config/models.js";
import { recordUsage, extractTokenFields } from "./llm-usage.js";
import { runTextToolsLoop } from "./agent-loop-text-tools.js";
import { toWellFormed, sanitizeMessages } from "./well-formed-text.js";

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
/**
 * LLM 呼び出しで生じた認証エラー（401 / authentication_error）を、ユーザーが次に
 * 何をすべきか分かる日本語メッセージへ変換する。認証エラーでなければ null を返す。
 * 全 AI 機能（翻訳・Wiki・Chat 等）は runAgentLoop を通るため、ここ 1 箇所で導線を集約できる。
 */
export function describeAuthError(err: unknown, provider?: string): string | null {
  const e = err as { statusCode?: number; status?: number; message?: string } | undefined;
  const status = e?.statusCode ?? e?.status;
  const msg = String(e?.message ?? err ?? "").toLowerCase();
  const isAuth =
    status === 401 ||
    msg.includes("authentication_error") ||
    msg.includes("invalid authentication") ||
    msg.includes("unauthorized") ||
    /\b401\b/.test(msg);
  if (!isAuth) return null;
  if (provider === "claude-subscription") {
    // サブスク（Claude Code CLI 経由）は OAuth セッション切れが原因。API キー再設定では直らない。
    return "Claude のサブスク認証が切れています。ターミナルで `claude` を実行して再ログインし、Graphium を再起動してから、もう一度お試しください。";
  }
  return "モデルの API キーが無効か期限切れです。Settings → AI Setup でキーを確認してください。";
}

export async function runAgentLoop(params: AgentRunParams): Promise<AgentRunResult> {
  try {
    return await runAgentLoopInner(params);
  } catch (err) {
    // 認証エラー（401）だけ provider 別の導線メッセージへ変換。それ以外はそのまま投げ直す。
    const friendly = describeAuthError(err, params.modelConfig?.provider);
    if (friendly) throw new Error(friendly);
    throw err;
  }
}

async function runAgentLoopInner(params: AgentRunParams): Promise<AgentRunResult> {
  // ノート本文や Wiki context を文字数で切り詰めた際に生じる lone surrogate（壊れたサロゲートペア）を
  // ここで無害化する。これを残したまま JSON.stringify すると Anthropic API（Python 側）が
  // 「no low surrogate in string」で 400 を返すため、API 境界の手前で一括サニタイズする。
  // ネイティブループ・text-tools フォールバックの両経路がこの params を起点にするので、ここ 1 箇所で両方カバーできる。
  const safeParams: AgentRunParams = {
    ...params,
    systemPrompt: toWellFormed(params.systemPrompt),
    messages: sanitizeMessages(params.messages),
  };
  const { model, modelId, systemPrompt, messages, tools, maxSteps = 10, feature, modelConfig, temperature } = safeParams;

  // openai-compatible（sakura / gpt-oss-120b 等）に加え、claude-subscription
  // （ai-sdk-provider-claude-code 経由）も AI SDK の tools パラメータをネイティブに
  // 扱えない。両者ともツール利用時は text-tool-call フォールバックループに切り替える。
  const providerLacksNativeTools =
    modelConfig?.provider === "openai-compatible" ||
    modelConfig?.provider === "claude-subscription";
  const useTextToolsLoop =
    providerLacksNativeTools && !!tools && Object.keys(tools).length > 0;
  if (useTextToolsLoop) {
    return runTextToolsLoop(safeParams);
  }

  // claude-subscription は temperature 等のサンプリングパラメータ非対応（CLI が制御）。
  // 渡すと unsupported 警告が出るだけなので、このプロバイダでは送らない。
  const supportsTemperature = modelConfig?.provider !== "claude-subscription";

  const startedAt = Date.now();
  const result = await generateText({
    model,
    system: systemPrompt,
    messages,
    ...(temperature !== undefined && supportsTemperature ? { temperature } : {}),
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
