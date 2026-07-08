// OpenAI 互換 endpoint のうち function calling をネイティブに扱わないモデル向けの fallback ループ。
// tools をネイティブ機能で渡す代わりに、ツール定義を system prompt に埋め込み、
// LLM からの応答テキストに含まれる `<tool_call>...</tool_call>` ブロックをパースして MCP ツールを実行する。
// dify など他の MCP 実装が採用する ReAct スタイルに近い。
//
// 対象: sakura ai engine / gpt-oss-120b 等の「OpenAI 互換だが tools パラメータを実質サポートしない」endpoint。
// Anthropic / OpenAI 本家 / Google など function calling を正しく扱うプロバイダは agent-loop.ts のネイティブループを使う。

import { generateText, asSchema, type ModelMessage } from "ai";
import type { AgentRunParams, AgentRunResult, ToolCallRecord } from "./agent-loop.js";
import { recordUsage, extractTokenFields } from "./llm-usage.js";

type AnyTool = {
  description?: string;
  inputSchema: unknown;
  execute?: (input: unknown, options: unknown) => Promise<unknown> | unknown;
};

type ParsedCall = {
  name: string;
  arguments: Record<string, unknown>;
  rawBlock: string;
};

const TOOL_CALL_REGEX = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export async function runTextToolsLoop(params: AgentRunParams): Promise<AgentRunResult> {
  const { model, modelId, systemPrompt, messages, tools, maxSteps = 10, feature, modelConfig, abortSignal } = params;

  const toolMap: Record<string, AnyTool> = (tools ?? {}) as Record<string, AnyTool>;
  const toolNames = Object.keys(toolMap);

  const augmentedSystem = toolNames.length > 0
    ? `${systemPrompt}\n\n${await buildToolsPromptSection(toolMap)}`
    : systemPrompt;

  const currentMessages: ModelMessage[] = [...messages];
  const toolCalls: ToolCallRecord[] = [];

  // 集計用
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalReasoning = 0;
  let totalTokens = 0;
  let lastText = "";
  const startedAt = Date.now();

  for (let step = 0; step < maxSteps; step += 1) {
    // 中断されたらツール実行の合間でも離脱する（次ステップの LLM 呼び出しを避ける）
    if (abortSignal?.aborted) break;
    const r = await generateText({
      model,
      system: augmentedSystem,
      messages: currentMessages,
      ...(abortSignal ? { abortSignal } : {}),
    });
    const tokens = extractTokenFields(r.usage);
    totalInput += tokens.inputTokens;
    totalOutput += tokens.outputTokens;
    totalCacheRead += tokens.cacheReadTokens ?? 0;
    totalCacheWrite += tokens.cacheWriteTokens ?? 0;
    totalReasoning += tokens.reasoningTokens ?? 0;
    totalTokens += tokens.totalTokens;

    lastText = r.text ?? "";
    const calls = extractToolCalls(lastText);

    if (calls.length === 0 || toolNames.length === 0) {
      break;
    }

    // assistant のテキスト（tool_call ブロック含む）を会話に積む
    currentMessages.push({ role: "assistant", content: lastText });

    // 1 ステップ内で複数 tool_call が同時に来てもまとめて実行する
    const resultParts: string[] = [];
    for (const call of calls) {
      const tool = toolMap[call.name];
      const callStart = Date.now();
      let output: unknown;
      let isError = false;
      if (!tool || typeof tool.execute !== "function") {
        output = { error: `unknown tool: ${call.name}` };
        isError = true;
      } else {
        try {
          output = await tool.execute(call.arguments, {
            toolCallId: `text-tools-${step}-${call.name}-${Date.now()}`,
            messages: currentMessages,
          });
        } catch (err) {
          output = { error: err instanceof Error ? err.message : String(err) };
          isError = true;
        }
      }
      toolCalls.push({
        tool_name: call.name,
        input: call.arguments,
        output: (isError ? output : { result: output }) as Record<string, unknown>,
        duration_ms: Date.now() - callStart,
      });
      resultParts.push(
        `<tool_result name="${call.name}">\n${safeStringify(output)}\n</tool_result>`,
      );
    }

    // tool 結果をユーザーメッセージとして次ターンに渡す
    currentMessages.push({
      role: "user",
      content: resultParts.join("\n"),
    });
  }

  // 最終 text に tool_call ブロックが残っていたらユーザーには出さない
  const cleanedMessage = stripToolCallBlocks(lastText);

  const durationMs = Date.now() - startedAt;
  if (feature) {
    recordUsage({
      ts: new Date().toISOString(),
      feature,
      provider: modelConfig?.provider ?? "unknown",
      modelId,
      modelConfigId: modelConfig?.id,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead || undefined,
      cacheWriteTokens: totalCacheWrite || undefined,
      reasoningTokens: totalReasoning || undefined,
      totalTokens,
      durationMs,
      rateSnapshot: modelConfig?.rate,
    });
  }

  return {
    message: cleanedMessage,
    toolCalls,
    tokenUsage: {
      input_tokens: totalInput,
      output_tokens: totalOutput,
      total_tokens: totalTokens,
      cache_read_tokens: totalCacheRead || undefined,
      cache_write_tokens: totalCacheWrite || undefined,
      reasoning_tokens: totalReasoning || undefined,
    },
    model: modelId,
  };
}

async function buildToolsPromptSection(toolMap: Record<string, AnyTool>): Promise<string> {
  const lines: string[] = [
    "# Tool Use",
    "",
    "You have access to external tools listed below. When the user's question requires data, facts, or computations that you don't already know, you MUST call a tool. Do not describe how to use the tools — actually call them.",
    "",
    "## Output format",
    "",
    "To call a tool, emit a block exactly in this form (no markdown fences, no extra commentary on the same lines):",
    "",
    "<tool_call>",
    `{"name": "tool_name", "arguments": { ... }}`,
    "</tool_call>",
    "",
    "Rules (follow strictly):",
    "1. If a relevant tool exists for the user's request, your FIRST response MUST contain only one or more <tool_call> blocks (and optionally a brief one-line plan before them). Never describe the tool's API or explain steps in prose instead of calling it.",
    "2. Never fabricate tool results. If you have not received a <tool_result> in the conversation, the data does not exist yet — call the tool.",
    "3. After the next user message includes <tool_result name=\"...\">...</tool_result>, read the results and either: (a) emit more <tool_call> blocks to gather more data, or (b) answer the user in plain prose based on the actual results returned.",
    "4. Final answers to the user MUST NOT contain SPARQL/SQL/code that you wrote yourself unless the user explicitly asked for code — execute the query through a tool instead.",
    "5. `arguments` MUST be a JSON object matching the tool's input schema. Omit unknown fields rather than guessing.",
    "6. When no tool is needed (e.g. greeting, opinion question), just answer in plain text without any <tool_call> block.",
    "",
    "## Example",
    "",
    "User: \"What is the capital of France according to Wikipedia?\"",
    "Assistant:",
    "<tool_call>",
    `{"name": "search_wikipedia", "arguments": {"query": "capital of France"}}`,
    "</tool_call>",
    "",
    "(After receiving the tool_result, the assistant then answers in prose using the actual returned data.)",
    "",
    "## Available tools",
  ];

  for (const [name, tool] of Object.entries(toolMap)) {
    const desc = tool.description ?? "";
    let schemaJson = "{}";
    try {
      const schema = asSchema(tool.inputSchema as never);
      const resolved = await Promise.resolve(schema.jsonSchema);
      schemaJson = JSON.stringify(resolved ?? {}, null, 2);
    } catch {
      schemaJson = "{}";
    }
    lines.push(
      "",
      `### ${name}`,
      desc ? desc : "(no description)",
      "",
      "Input schema (JSON Schema):",
      "```json",
      schemaJson,
      "```",
    );
  }

  return lines.join("\n");
}

export function extractToolCalls(text: string): ParsedCall[] {
  if (!text) return [];
  const calls: ParsedCall[] = [];
  TOOL_CALL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_CALL_REGEX.exec(text)) !== null) {
    const block = match[0];
    const inner = match[1].trim();
    const parsed = parseToolCallPayload(inner);
    if (parsed) {
      calls.push({ name: parsed.name, arguments: parsed.arguments, rawBlock: block });
    }
  }
  return calls;
}

function parseToolCallPayload(raw: string): { name: string; arguments: Record<string, unknown> } | null {
  // モデルによっては ```json ... ``` で包んでくることがあるので剥がす
  let body = raw.trim();
  if (body.startsWith("```")) {
    body = body.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  try {
    const obj = JSON.parse(body) as { name?: unknown; arguments?: unknown; args?: unknown };
    if (typeof obj.name !== "string") return null;
    const args = obj.arguments ?? obj.args ?? {};
    if (typeof args !== "object" || args === null) {
      return { name: obj.name, arguments: {} };
    }
    return { name: obj.name, arguments: args as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function stripToolCallBlocks(text: string): string {
  if (!text) return "";
  return text.replace(TOOL_CALL_REGEX, "").trim();
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
