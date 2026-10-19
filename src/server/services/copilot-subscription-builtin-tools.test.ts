import { afterEach, describe, expect, it, vi } from "vitest";

// Copilot SDK を差し替え、createSession に渡った設定と、send 後に流すイベント列を制御する。
// 実際の CLI は spawn しない。イベントの形は実測（CLI 1.0.98、2026-10-19）に合わせている。
type Handler = (event: unknown) => void;
const state = vi.hoisted(() => ({
  createSessionConfigs: [] as Array<Record<string, unknown>>,
  script: [] as Array<{ type: string; data: Record<string, unknown> }>,
}));

vi.mock("@github/copilot-sdk", () => {
  class FakeSession {
    sessionId = "fake-session";
    private handlers = new Set<Handler>();
    on(handler: Handler): () => void {
      this.handlers.add(handler);
      return () => {
        this.handlers.delete(handler);
      };
    }
    async send(): Promise<string> {
      for (const ev of state.script) {
        await Promise.resolve();
        for (const h of [...this.handlers]) h({ ...ev, id: "e", parentId: null, timestamp: "" });
      }
      return "msg";
    }
    async abort(): Promise<void> {}
  }
  class CopilotClient {
    async start(): Promise<void> {}
    async createSession(config: Record<string, unknown>): Promise<FakeSession> {
      state.createSessionConfigs.push(config);
      return new FakeSession();
    }
    async deleteSession(): Promise<void> {}
    async forceStop(): Promise<void> {}
  }
  return {
    CopilotClient,
    RuntimeConnection: { forStdio: (opts: unknown) => opts },
    defineTool: (name: string, def: Record<string, unknown>) => ({ name, ...def }),
  };
});

import {
  parseBuiltinToolResult,
  resetCopilotClients,
  runCopilotWithTools,
} from "./copilot-subscription.js";
import { extractWebSources } from "./web-sources.js";

const WEB_SEARCH_CONTENT = JSON.stringify({
  annotations: null,
  bing_searches: [{ text: "graphium release", url: "https://www.bing.com/search?q=graphium+release" }],
  text: {
    annotations: [
      {
        end_index: 10,
        start_index: 0,
        text: "",
        url_citation: {
          title: "Releases · kumagallium/Graphium",
          url: "https://github.com/kumagallium/Graphium/releases",
        },
      },
    ],
    value: "The newest release is v0.89.7【3:0†source】.",
  },
  type: "output_text",
});

const GRAPHIUM_TOOLS = {
  notes_search: {
    description: "search notes",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
    execute: async () => ({ hits: [] }),
  },
};

function scriptWithWebSearch() {
  return [
    { type: "assistant.message", data: { content: "", toolRequests: [{ toolCallId: "c1", name: "web_search" }] } },
    {
      type: "tool.execution_start",
      data: { toolCallId: "c1", toolName: "web_search", arguments: { query: "graphium release" } },
    },
    {
      type: "tool.execution_complete",
      data: { toolCallId: "c1", success: true, result: { content: WEB_SEARCH_CONTENT } },
    },
    { type: "assistant.turn_end", data: {} },
    // Graphium 側ツールの実行イベント。handler が記録する側なので、ここでは二重に拾わない。
    { type: "tool.execution_start", data: { toolCallId: "c2", toolName: "notes_search", arguments: { q: "x" } } },
    { type: "tool.execution_complete", data: { toolCallId: "c2", success: true, result: { content: "{}" } } },
    { type: "assistant.message", data: { content: "The newest release is v0.89.7." } },
    { type: "assistant.usage", data: { inputTokens: 10, outputTokens: 5, finishReason: "stop" } },
    { type: "assistant.turn_end", data: {} },
    { type: "session.idle", data: {} },
  ];
}

const PROMPT = [
  { role: "user" as const, content: [{ type: "text" as const, text: "latest graphium release?" }] },
];

describe("runCopilotWithTools: builtinTools（Copilot 内蔵ツール）", () => {
  afterEach(async () => {
    state.createSessionConfigs.length = 0;
    state.script = [];
    await resetCopilotClients();
  });

  it("builtinTools を availableTools に足し、CLI 側で実行された内蔵ツールの結果を toolCalls に記録する", async () => {
    state.script = scriptWithWebSearch();
    const result = await runCopilotWithTools({
      settings: { cliPath: "/fake/copilot", modelId: "default" },
      systemPrompt: "sys",
      prompt: PROMPT,
      tools: GRAPHIUM_TOOLS,
      builtinTools: ["web_search"],
    });

    expect(state.createSessionConfigs[0].availableTools).toEqual(["notes_search", "web_search"]);
    expect(result.text).toBe("The newest release is v0.89.7.");
    // 内蔵ツールだけが記録される（Graphium のツールは handler 側の記録に任せる）
    expect(result.toolCalls.map((t) => t.tool_name)).toEqual(["web_search"]);
    expect(result.toolCalls[0].input).toEqual({ query: "graphium release" });
    // JSON 文字列の content が構造に戻り、出典抽出まで通る
    expect(extractWebSources(result.toolCalls)).toEqual([
      { title: "Releases · kumagallium/Graphium", url: "https://github.com/kumagallium/Graphium/releases" },
    ]);
  });

  it("builtinTools が無ければ availableTools は Graphium のツールだけで、内蔵ツールのイベントは無視する", async () => {
    state.script = scriptWithWebSearch();
    const result = await runCopilotWithTools({
      settings: { cliPath: "/fake/copilot", modelId: "default" },
      systemPrompt: "sys",
      prompt: PROMPT,
      tools: GRAPHIUM_TOOLS,
    });
    expect(state.createSessionConfigs[0].availableTools).toEqual(["notes_search"]);
    expect(result.toolCalls).toEqual([]);
  });

  it("失敗した内蔵ツール呼び出しは error を output に残す", async () => {
    state.script = [
      { type: "tool.execution_start", data: { toolCallId: "c1", toolName: "web_search", arguments: { query: "q" } } },
      {
        type: "tool.execution_complete",
        data: { toolCallId: "c1", success: false, error: { message: "search backend unavailable" } },
      },
      { type: "assistant.message", data: { content: "Could not search." } },
      { type: "session.idle", data: {} },
    ];
    const result = await runCopilotWithTools({
      settings: { cliPath: "/fake/copilot", modelId: "default" },
      systemPrompt: "sys",
      prompt: PROMPT,
      tools: {},
      builtinTools: ["web_search"],
    });
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ tool_name: "web_search", output: { error: "search backend unavailable" } }),
    ]);
  });
});

describe("parseBuiltinToolResult", () => {
  it("JSON 文字列の content は構造に戻す", () => {
    expect(parseBuiltinToolResult({ content: WEB_SEARCH_CONTENT })).toMatchObject({
      type: "output_text",
      text: { annotations: [expect.objectContaining({ url_citation: expect.anything() })] },
    });
  });

  it("structuredContent があればそれを優先する", () => {
    expect(
      parseBuiltinToolResult({ content: "{\"a\":1}", structuredContent: { b: 2 } }),
    ).toEqual({ b: 2 });
  });

  it("JSON として読めない本文はそのまま content に持つ", () => {
    expect(parseBuiltinToolResult({ content: "plain text {not json" })).toEqual({
      content: "plain text {not json",
    });
    expect(parseBuiltinToolResult(undefined)).toEqual({ content: "" });
  });

  it("配列の JSON は result に包む", () => {
    expect(parseBuiltinToolResult({ content: "[1,2]" })).toEqual({ result: [1, 2] });
  });
});
