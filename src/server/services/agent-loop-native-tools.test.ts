// openai-compatible endpoint に対するネイティブ tool calling の探索とフォールバックの検証。
//
// 「まずネイティブで投げ、tools 起因のエラーが出たら text-tool-call 経路へ落として記憶する」
// という runAgentLoop の分岐が、実際に endpoint の挙動どおりに経路を選ぶかを見る。

import { describe, it, expect, beforeEach } from "vitest";
import { jsonSchema } from "ai";
import { runAgentLoop } from "./agent-loop.js";
import {
  resetNativeToolsVerdicts,
  getNativeToolsVerdict,
  nativeToolsCacheKey,
} from "./native-tools-support.js";

type Call = { hadTools: boolean; system: string };

/** doGenerate の呼び出しを記録するダミーモデル。tools の有無で挙動を変えられる。 */
function makeModel(opts: {
  /** tools 付きで呼ばれたときに投げるエラー。未指定ならテキストを返す。 */
  throwOnTools?: unknown;
}) {
  const calls: Call[] = [];
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "test-model",
    supportedUrls: {},
    doGenerate: async (options: { tools?: unknown[]; prompt: unknown }) => {
      const hadTools = Array.isArray(options.tools) && options.tools.length > 0;
      const prompt = options.prompt as Array<{ role: string; content: unknown }>;
      const system = prompt.find((m) => m.role === "system");
      calls.push({ hadTools, system: typeof system?.content === "string" ? system.content : "" });
      if (hadTools && opts.throwOnTools !== undefined) throw opts.throwOnTools;
      return {
        content: [{ type: "text" as const, text: "done" }],
        finishReason: "stop" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("not used");
    },
  };
  return { model, calls };
}

const SAKURA_CONFIG = {
  id: "m1",
  name: "sakura",
  provider: "openai-compatible",
  modelId: "test-model",
  apiKey: "k",
  apiBase: "https://api.example/v1",
} as never;

const TOOLS = {
  search: {
    description: "search the web",
    inputSchema: jsonSchema({
      type: "object",
      properties: { q: { type: "string" } },
    }),
    execute: async () => ({ hits: [] }),
  },
};

function run(model: unknown, modelConfig: unknown = SAKURA_CONFIG) {
  return runAgentLoop({
    model: model as never,
    modelId: "test-model",
    systemPrompt: "you are a test",
    messages: [{ role: "user", content: "hi" }],
    tools: TOOLS,
    modelConfig: modelConfig as never,
  });
}

describe("openai-compatible のネイティブ tool calling 探索", () => {
  beforeEach(() => resetNativeToolsVerdicts());

  it("tools を受け付ける endpoint にはネイティブで渡す（system prompt にツール定義を埋め込まない）", async () => {
    const { model, calls } = makeModel({});
    const result = await run(model);

    expect(result.message).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0].hadTools).toBe(true);
    // text-tool-call 経路なら system にツール定義が差し込まれる。ネイティブ経路では素のまま。
    expect(calls[0].system).toBe("you are a test");
  });

  it("ネイティブで通ったら supported を記憶する", async () => {
    const { model } = makeModel({});
    await run(model);
    expect(
      getNativeToolsVerdict(
        nativeToolsCacheKey({
          provider: "openai-compatible",
          apiBase: "https://api.example/v1",
          modelId: "test-model",
        }),
      ),
    ).toBe("supported");
  });

  it("tools を知らない 400 が返ったら text-tool-call 経路へ落ちる", async () => {
    const { model, calls } = makeModel({
      throwOnTools: Object.assign(new Error("Unrecognized request argument supplied: tools"), {
        statusCode: 400,
      }),
    });
    const result = await run(model);

    expect(result.message).toBe("done");
    // 1 回目はネイティブ（tools 付き）で失敗、2 回目は tools なしでツール定義を system に埋め込む
    expect(calls).toHaveLength(2);
    expect(calls[0].hadTools).toBe(true);
    expect(calls[1].hadTools).toBe(false);
    expect(calls[1].system).toContain("search");
  });

  it("一度 unsupported と分かったら次回はネイティブを試さない", async () => {
    const failing = makeModel({
      throwOnTools: Object.assign(new Error("unknown parameter: tools"), { statusCode: 400 }),
    });
    await run(failing.model);

    const second = makeModel({
      throwOnTools: new Error("ここには来ないはず"),
    });
    await run(second.model);
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0].hadTools).toBe(false);
  });

  it("認証エラーはフォールバックせず呼び出し元へ投げ直す", async () => {
    const { model, calls } = makeModel({
      throwOnTools: Object.assign(new Error("authentication_error"), { statusCode: 401 }),
    });
    await expect(run(model)).rejects.toThrow();
    // フォールバックしていない（2 回目の呼び出しが無い）
    expect(calls).toHaveLength(1);
  });

  it("tools と無関係な 400 もフォールバックしない", async () => {
    const { model, calls } = makeModel({
      throwOnTools: Object.assign(new Error("context length exceeded"), { statusCode: 400 }),
    });
    await expect(run(model)).rejects.toThrow("context length exceeded");
    expect(calls).toHaveLength(1);
  });

  it("endpoint が違えば別々に学習する", async () => {
    const failing = makeModel({
      throwOnTools: Object.assign(new Error("unknown parameter: tools"), { statusCode: 400 }),
    });
    await run(failing.model, { ...(SAKURA_CONFIG as object), apiBase: "https://a/v1" });

    // 別 endpoint は未探索なのでネイティブから試す
    const other = makeModel({});
    await run(other.model, { ...(SAKURA_CONFIG as object), apiBase: "https://b/v1" });
    expect(other.calls[0].hadTools).toBe(true);
  });
});

describe("サブスク型プロバイダ", () => {
  beforeEach(() => resetNativeToolsVerdicts());

  it("copilot-subscription はネイティブを試さず最初から text-tool-call 経路", async () => {
    const { model, calls } = makeModel({
      throwOnTools: new Error("ネイティブで呼ばれてはいけない"),
    });
    await run(model, {
      id: "m2",
      name: "copilot",
      provider: "copilot-subscription",
      modelId: "test-model",
      apiKey: "",
      apiBase: null,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].hadTools).toBe(false);
  });
});

describe("ネイティブ対応プロバイダ", () => {
  beforeEach(() => resetNativeToolsVerdicts());

  it("anthropic は探索せずそのままネイティブで投げる（エラーもフォールバックしない）", async () => {
    const { model, calls } = makeModel({
      throwOnTools: Object.assign(new Error("unknown parameter: tools"), { statusCode: 400 }),
    });
    await expect(
      run(model, {
        id: "m3",
        name: "claude",
        provider: "anthropic",
        modelId: "test-model",
        apiKey: "k",
        apiBase: null,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});
