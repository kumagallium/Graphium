// エージェントループ
// Vercel AI SDK の generateText + stepCountIs でマルチステップ実行する

import { generateText, stepCountIs, type ModelMessage, type LanguageModel } from "ai";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { ModelConfig } from "../config/models.js";
import { recordUsage, extractTokenFields } from "./llm-usage.js";
import { runTextToolsLoop } from "./agent-loop-text-tools.js";
import { toWellFormed, sanitizeMessages } from "./well-formed-text.js";
import { CodedError, type AiErrorCode } from "../../lib/ai-error-codes.js";
import { isSubscriptionProvider } from "../../lib/subscription-providers.js";
import {
  nativeToolsCacheKey,
  getNativeToolsVerdict,
  setNativeToolsVerdict,
  isToolsUnsupportedError,
} from "./native-tools-support.js";

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
  /** 中断シグナル。ユーザーが Stop したとき LLM 呼び出しを打ち切る（無駄なトークン消費を止める）。 */
  abortSignal?: AbortSignal;
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
 * ツールが渡されているとき、ネイティブの function calling を扱えないモデルへは
 * tools 定義を system prompt に埋め込んで `<tool_call>...</tool_call>` ベースのテキスト応答を
 * パースする fallback ループへ切り替える。切り替えの判断は provider ごとに異なる:
 *
 * - copilot-subscription: generateText を経由せず、Copilot SDK にツール（handler 付き）を
 *   渡してエージェントとして実行する（runCopilotAgentLoop）。ネイティブのツール実行
 * - 他のサブスク型: SDK が tools を通さない前提で常に fallback
 * - openai-compatible: endpoint 次第（さくらの AI Engine のように tool_calls を返すものもある）。
 *   まずネイティブで試し、tools 起因のエラーが出たときだけ fallback して結果を記憶する
 *   → native-tools-support.ts
 * - それ以外（anthropic / openai / google）: 常にネイティブ
 */
/**
 * LLM 呼び出しで生じた認証エラー（401 / authentication_error）を、ユーザーが次に
 * 何をすべきか分かるメッセージ + 機械可読コードへ変換する。認証エラーでなければ null を返す。
 * メッセージはサーバー発の英語フォールバック（サーバーは locale を知らない）。
 * クライアントは code を i18n 文言に置き換える（src/lib/ai-error.ts の localizeAiError）。
 * 全 AI 機能（翻訳・Wiki・Chat 等）は runAgentLoop を通るため、ここ 1 箇所で導線を集約できる。
 */
export function describeAuthError(
  err: unknown,
  provider?: string,
): { message: string; code: AiErrorCode } | null {
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
  if (provider === "copilot-subscription") {
    // GitHub Copilot CLI のログイン切れ・未ログイン。API キー再設定では直らない。
    return {
      message:
        "GitHub Copilot authentication is missing or expired. Run `copilot` in a terminal to sign in, then retry.",
      code: "COPILOT_SUBSCRIPTION_AUTH_EXPIRED",
    };
  }
  return {
    message:
      "The model API key is invalid or expired. Check the key in Settings → AI.",
    code: "INVALID_API_KEY",
  };
}

/**
 * Anthropic プロバイダに明示する出力トークン上限。
 * 現行 Claude（Opus/Sonnet/Haiku 4.5+）の出力上限は 64K〜128K なので全モデル安全圏。
 * thinking（Opus 5 系は常時オン）と本文がこの枠を分け合うため、小さすぎると
 * JSON 出力が途中切断される。
 */
const ANTHROPIC_MAX_OUTPUT_TOKENS = 16384;

export async function runAgentLoop(params: AgentRunParams): Promise<AgentRunResult> {
  try {
    return await runAgentLoopInner(params);
  } catch (err) {
    // 認証エラー（401）だけ provider 別の導線メッセージ + code へ変換。それ以外はそのまま投げ直す。
    // CodedError の code は各ルートの catch（errorBody）が JSON レスポンスへ通す。
    const friendly = describeAuthError(err, params.modelConfig?.provider);
    if (friendly) throw new CodedError(friendly.message, friendly.code);
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
  const { model, modelId, systemPrompt, messages, tools, maxSteps = 10, feature, modelConfig, temperature, abortSignal } = safeParams;

  const hasTools = !!tools && Object.keys(tools).length > 0;
  const isOpenAiCompatible = modelConfig?.provider === "openai-compatible";

  // copilot-subscription のツール付き呼び出しは、generateText を経由せず Copilot SDK に
  // ツール（handler 付き）を渡してエージェントとして実行する第 3 の経路へ。
  // AI SDK の LanguageModel 経路では execute が剥がされて実行できないため
  // （詳細は copilot-subscription.ts の runCopilotWithTools）。
  if (hasTools && modelConfig?.provider === "copilot-subscription") {
    return runCopilotAgentLoop(safeParams);
  }
  // 他のサブスク型が増えたときの既定: SDK が tools を通さない前提で text-tool-call へ。
  if (hasTools && isSubscriptionProvider(modelConfig?.provider)) {
    return runTextToolsLoop(safeParams);
  }

  // openai-compatible は endpoint によってネイティブ tool calling の可否が分かれる。
  // 学習済みなら記憶した経路へ直行し、未探索ならネイティブで試して結果を記憶する。
  const toolsCacheKey = nativeToolsCacheKey({
    provider: modelConfig?.provider,
    apiBase: modelConfig?.apiBase,
    modelId,
  });
  const nativeToolsVerdict = isOpenAiCompatible && hasTools
    ? getNativeToolsVerdict(toolsCacheKey)
    : "supported";
  if (nativeToolsVerdict === "unsupported") {
    return runTextToolsLoop(safeParams);
  }
  // 未探索の openai-compatible だけが「失敗したらフォールバックする」対象。
  const probingNativeTools = isOpenAiCompatible && hasTools && nativeToolsVerdict === "unknown";

  // サブスク型プロバイダは temperature 等のサンプリングパラメータ非対応（CLI が制御）。
  // 渡すと unsupported 警告が出るだけなので、これらのプロバイダでは送らない。
  const supportsTemperature = !isSubscriptionProvider(modelConfig?.provider);

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof generateText>>;
  try {
    result = await generateText({
      model,
      system: systemPrompt,
      messages,
      ...(temperature !== undefined && supportsTemperature ? { temperature } : {}),
      // Anthropic は API 仕様上 max_tokens が必須で、未指定だと AI SDK の小さな既定値に
      // 頭打ちされる。現行 Claude は thinking が同じ max_tokens を消費するため、既定値の
      // ままだと atomize / ingest のような長い JSON 出力が本文の途中で切れて壊れ JSON に
      // なる（「洞察 0 件」に見える silent failure の原因）。現行 Claude の出力上限は
      // 64K〜128K なので 16K は全モデル安全圏。openai-compatible はプロバイダ既定
      // （通常はモデル上限）が使われるので指定しない。
      ...(modelConfig?.provider === "anthropic" ? { maxOutputTokens: ANTHROPIC_MAX_OUTPUT_TOKENS } : {}),
      // tools が空の場合は undefined にする
      ...(hasTools ? { tools: tools as any } : {}),
      stopWhen: stepCountIs(maxSteps),
      ...(abortSignal ? { abortSignal } : {}),
    });
  } catch (err) {
    // tools を受け付けない endpoint だと分かったら、記憶したうえで text-tool-call 経路へ回す。
    // それ以外のエラー（認証・レート制限・サーバー障害・中断）はそのまま呼び出し元へ。
    if (probingNativeTools && isToolsUnsupportedError(err)) {
      setNativeToolsVerdict(toolsCacheKey, "unsupported");
      console.warn(
        `[agent-loop] ${modelId}: endpoint がネイティブ tool calling を受け付けなかったため text-tool-call 経路へ切り替えた`,
      );
      return runTextToolsLoop(safeParams);
    }
    throw err;
  }
  if (probingNativeTools) {
    // ネイティブで通った endpoint は以降フォールバックの検討をしない。
    setNativeToolsVerdict(toolsCacheKey, "supported");
  }
  const durationMs = Date.now() - startedAt;

  // ツール呼び出しの記録を収集。ツール結果（output）も toolCallId で突き合わせて焼き込む
  // （web 検索 MCP の出典抽出 web-sources.ts が output を読む）。
  const toolCalls: ToolCallRecord[] = [];
  for (const step of result.steps) {
    const outputById = new Map<string, unknown>();
    for (const tr of step.toolResults ?? []) {
      const r = tr as { toolCallId?: string; output?: unknown };
      if (r.toolCallId !== undefined) outputById.set(r.toolCallId, r.output);
    }
    for (const tc of step.toolCalls ?? []) {
      const raw = outputById.get((tc as { toolCallId?: string }).toolCallId ?? "");
      const output =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>)
        : raw != null ? { result: raw }
        : {};
      toolCalls.push({
        tool_name: tc.toolName,
        input: tc.input as Record<string, unknown>,
        output,
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

// ── Copilot をエージェントとして実行する経路 ──
//
// copilot-subscription でツールが渡されたときだけ通る。generateText を経由せず、
// Copilot SDK にツール（handler 付き）を渡してエージェントループを CLI 側に回させる。
// 戻り値は他の経路と同じ AgentRunResult に揃える（呼び出し側は経路を意識しない）。

/** AI SDK の ModelMessage（content が string のこともある）を LanguageModelV3Prompt の形へ */
function toV3Prompt(system: string, messages: ModelMessage[]): LanguageModelV3Prompt {
  const out: LanguageModelV3Prompt = [];
  if (system.trim()) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "system") {
      out.push({ role: "system", content: typeof m.content === "string" ? m.content : "" });
      continue;
    }
    if (typeof m.content === "string") {
      if (m.role === "user") out.push({ role: "user", content: [{ type: "text", text: m.content }] });
      else if (m.role === "assistant") out.push({ role: "assistant", content: [{ type: "text", text: m.content }] });
      continue;
    }
    // パート配列はそのまま流す（flattenPromptForCopilot がテキスト以外を落として warning にする）
    out.push({ role: m.role, content: m.content } as LanguageModelV3Prompt[number]);
  }
  return out;
}

async function runCopilotAgentLoop(params: AgentRunParams): Promise<AgentRunResult> {
  const { modelId, systemPrompt, messages, tools, feature, modelConfig, abortSignal } = params;
  const { runCopilotWithTools } = await import("./copilot-subscription.js");
  const { resolveCopilotBinaryPath } = await import("./llm.js");

  const cliPath = resolveCopilotBinaryPath(modelConfig?.apiBase);
  if (!cliPath) {
    throw new Error(
      "GitHub Copilot CLI not found. Install it (e.g. `npm install -g @github/copilot`), sign in with `copilot`, or set the CLI path in Settings → AI.",
    );
  }

  const startedAt = Date.now();
  const result = await runCopilotWithTools({
    settings: { cliPath, modelId: modelConfig?.modelId ?? modelId },
    // system は runCopilotWithTools 側で結合する。ここでは prompt に system を含めない。
    systemPrompt,
    prompt: toV3Prompt("", messages),
    tools: (tools ?? {}) as Record<string, { description?: string; inputSchema: unknown; execute?: (input: unknown, options: unknown) => unknown }>,
    ...(abortSignal ? { abortSignal } : {}),
  });
  const durationMs = Date.now() - startedAt;

  // runCopilotWithTools は provider レベルの LanguageModelV3Usage（inputTokens が
  // { total, cacheRead, ... } のネスト）を返す。extractTokenFields は generateText の
  // フラットな LanguageModelUsage を期待するので、ここで同じ形に写してから渡す。
  const v3 = result.usage;
  const tokens = extractTokenFields({
    inputTokens: v3.inputTokens?.total,
    outputTokens: v3.outputTokens?.total,
    inputTokenDetails: {
      cacheReadTokens: v3.inputTokens?.cacheRead,
      cacheWriteTokens: v3.inputTokens?.cacheWrite,
    },
    outputTokenDetails: { reasoningTokens: v3.outputTokens?.reasoning },
  });
  if (feature) {
    recordUsage({
      ts: new Date().toISOString(),
      feature,
      provider: modelConfig?.provider ?? "copilot-subscription",
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
    toolCalls: result.toolCalls,
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
