// 道具を呼び続けて歩数の上限に達したとき、回答が空のまま返らないこと（2026-11-05 の評価で
// gpt-oss が 15 問中 3 問で空回答）と、使用量が全ステップの合計で数えられること。

import { describe, it, expect, beforeEach } from "vitest";
import { jsonSchema, tool } from "ai";
import { runAgentLoop } from "./agent-loop.js";
import { FINAL_ANSWER_NUDGE, runTextToolsLoop } from "./agent-loop-text-tools.js";
import { resetNativeToolsVerdicts } from "./native-tools-support.js";

const TOOLS = {
  search: tool({
    description: "search my notes",
    inputSchema: jsonSchema({ type: "object", properties: { q: { type: "string" } } }),
    execute: async () => ({ hits: ["x"] }),
  }),
};

const ANTHROPIC = { id: "m1", name: "c", provider: "anthropic", modelId: "m", apiKey: "k", apiBase: null } as never;

/** 1 呼び出しあたり入力 100・出力 10 を返す。道具を選べるうちは毎回道具を呼ぶ */
function usage() {
  return {
    inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 10, text: 10, reasoning: undefined },
  };
}

function makeToolHappyModel() {
  const toolChoices: Array<string | undefined> = [];
  let n = 0;
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "m",
    supportedUrls: {},
    doGenerate: async (options: { tools?: unknown[]; toolChoice?: { type: string } }) => {
      toolChoices.push(options.toolChoice?.type);
      const canCallTools = Array.isArray(options.tools) && options.tools.length > 0 && options.toolChoice?.type !== "none";
      if (canCallTools) {
        n += 1;
        return {
          content: [{ type: "tool-call" as const, toolCallId: `c${n}`, toolName: "search", input: JSON.stringify({ q: `q${n}` }) }],
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage: usage(),
          warnings: [],
        };
      }
      return { content: [{ type: "text" as const, text: "final answer" }], finishReason: { unified: "stop" as const, raw: "stop" }, usage: usage(), warnings: [] };
    },
    doStream: async () => {
      throw new Error("not used");
    },
  };
  return { model, toolChoices };
}

describe("ネイティブ経路: 上限まで道具を呼んだとき", () => {
  beforeEach(() => resetNativeToolsVerdicts());

  it("道具を使わずに答える 1 回を足して、空でない回答を返す", async () => {
    const { model, toolChoices } = makeToolHappyModel();
    const r = await runAgentLoop({
      model: model as never,
      modelId: "m",
      systemPrompt: "s",
      messages: [{ role: "user", content: "q" }],
      tools: TOOLS,
      maxSteps: 3,
      modelConfig: ANTHROPIC,
    });
    expect(r.message).toBe("final answer");
    expect(r.toolCalls).toHaveLength(3);
    // 3 歩は道具を選べ、足した 1 回は toolChoice: none
    expect(toolChoices).toEqual(["auto", "auto", "auto", "none"]);
  });

  it("使用量は最後の 1 歩でなく、全ステップと足した 1 回の合計", async () => {
    const { model } = makeToolHappyModel();
    const r = await runAgentLoop({
      model: model as never,
      modelId: "m",
      systemPrompt: "s",
      messages: [{ role: "user", content: "q" }],
      tools: TOOLS,
      maxSteps: 3,
      modelConfig: ANTHROPIC,
    });
    expect(r.tokenUsage?.input_tokens).toBe(400);
    expect(r.tokenUsage?.output_tokens).toBe(40);
  });

  it("上限の前に答えたときは、何も足さない", async () => {
    const { model, toolChoices } = makeToolHappyModel();
    const r = await runAgentLoop({
      model: model as never,
      modelId: "m",
      systemPrompt: "s",
      messages: [{ role: "user", content: "q" }],
      maxSteps: 3,
      modelConfig: ANTHROPIC,
    });
    expect(r.message).toBe("final answer");
    expect(toolChoices).toEqual([undefined]);
  });
});

describe("テキスト道具の経路: 上限まで道具を呼んだとき", () => {
  it("道具の説明を外した 1 回を足して、空でない回答を返す", async () => {
    const systems: string[] = [];
    const lastUser: string[] = [];
    const model = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "m",
      supportedUrls: {},
      doGenerate: async (options: { prompt: Array<{ role: string; content: unknown }> }) => {
        const sys = options.prompt.find((m) => m.role === "system");
        systems.push(typeof sys?.content === "string" ? sys.content : "");
        const users = options.prompt.filter((m) => m.role === "user");
        const last = users[users.length - 1]?.content;
        const lastText = Array.isArray(last) ? (last as Array<{ text?: string }>).map((p) => p.text ?? "").join("") : String(last ?? "");
        lastUser.push(lastText);
        const text = lastText === FINAL_ANSWER_NUDGE ? "final answer" : '<tool_call>{"name":"search","arguments":{"q":"x"}}</tool_call>';
        return { content: [{ type: "text" as const, text }], finishReason: { unified: "stop" as const, raw: "stop" }, usage: usage(), warnings: [] };
      },
      doStream: async () => {
        throw new Error("not used");
      },
    };
    const r = await runTextToolsLoop({
      model: model as never,
      modelId: "m",
      systemPrompt: "base system",
      messages: [{ role: "user", content: "q" }],
      tools: TOOLS,
      maxSteps: 2,
    });
    expect(r.message).toBe("final answer");
    expect(systems).toHaveLength(3);
    expect(systems[2]).toBe("base system");
    expect(r.tokenUsage?.input_tokens).toBe(300);
  });
});
