// 目印が実際の Messages API のリクエスト本文にどう載るかを、送信を横取りして確かめる
import { describe, expect, it } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText, tool, wrapLanguageModel, stepCountIs } from "ai";
import { z } from "zod";
import {
  createAnthropicPromptCacheMiddleware,
  isOfficialAnthropicBase,
} from "./anthropic-prompt-cache";

type Body = {
  system?: { type: string; text: string; cache_control?: unknown }[];
  messages: { role: string; content: unknown }[];
  cache_control?: unknown;
};

const lastSystem = (body: Body) => body.system?.[body.system.length - 1];

const OK_RESPONSE = {
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 1 },
};

function capture(allowAutomatic: boolean) {
  const bodies: Body[] = [];
  const provider = createAnthropic({
    apiKey: "test-key",
    baseURL: "https://api.anthropic.com/v1",
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify(OK_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const model = wrapLanguageModel({
    model: provider("claude-opus-5"),
    middleware: createAnthropicPromptCacheMiddleware({ allowAutomatic }),
  });
  return { model, bodies };
}

const echo = tool({
  description: "echo",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }) => text,
});

describe("anthropic-prompt-cache", () => {
  it("システムプロンプトの最後のブロックに目印を置き、ツールの無い呼び出しには自動キャッシュを付けない", async () => {
    const { model, bodies } = capture(true);
    await generateText({ model, system: "固定の指示文", messages: [{ role: "user", content: "毎回違うページ本文" }] });
    const body = bodies[0];
    expect(lastSystem(body)?.cache_control).toEqual({ type: "ephemeral" });
    expect(body.cache_control).toBeUndefined();
    // user メッセージには目印を付けない
    expect(JSON.stringify(body.messages)).not.toContain("cache_control");
  });

  it("ツールを渡す呼び出しには、公式 API ならリクエスト全体の自動キャッシュも付ける", async () => {
    const { model, bodies } = capture(true);
    await generateText({
      model,
      system: "チャットの指示文",
      messages: [{ role: "user", content: "質問" }],
      tools: { echo },
      stopWhen: stepCountIs(1),
    });
    expect(bodies[0].cache_control).toEqual({ type: "ephemeral" });
    expect(lastSystem(bodies[0])?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("互換 endpoint ではツールがあっても自動キャッシュを付けない（ブロックの目印だけ）", async () => {
    const { model, bodies } = capture(false);
    await generateText({
      model,
      system: "チャットの指示文",
      messages: [{ role: "user", content: "質問" }],
      tools: { echo },
      stopWhen: stepCountIs(1),
    });
    expect(bodies[0].cache_control).toBeUndefined();
    expect(lastSystem(bodies[0])?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("システムプロンプトが無ければ何も付けない", async () => {
    const { model, bodies } = capture(true);
    await generateText({ model, messages: [{ role: "user", content: "質問" }] });
    expect(JSON.stringify(bodies[0])).not.toContain("cache_control");
  });

  it("呼び出し側が自分で目印を置いていれば上書きしない", async () => {
    const { model, bodies } = capture(true);
    await generateText({
      model,
      messages: [
        { role: "system", content: "指示文" },
        {
          role: "user",
          content: [{ type: "text", text: "長い資料", providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } } }],
        },
      ],
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    });
    const body = bodies[0];
    expect(lastSystem(body)?.cache_control).toBeUndefined();
    expect(body.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
  });

  it("ナレッジの題の一覧までを別のブロックに分け、質問ごとに変わる部分と別々に目印を置く（文面は変えない）", async () => {
    const { model, bodies } = capture(true);
    const stable = "指示文\n\n<wiki-index>\n- **題 A**\n</wiki-index>";
    const variable = "\n\n<knowledge>\n[#1 | Topic | \"題 A\"]\n本文\n</knowledge>\n\n末尾の指示";
    await generateText({ model, system: stable + variable, messages: [{ role: "user", content: "質問" }] });
    const system = bodies[0].system ?? [];
    expect(system.map((b) => b.text)).toEqual([stable, variable]);
    expect(system.map((b) => b.cache_control)).toEqual([{ type: "ephemeral" }, { type: "ephemeral" }]);
    expect(bodies[0].cache_control).toBeUndefined();
  });

  it("質問が変わっても、分けた前半のブロックは同じ内容のまま送られる", async () => {
    const { model, bodies } = capture(true);
    const stable = "指示文\n\n<wiki-index>\n- **題 A**\n</wiki-index>";
    for (const k of ["本文 1", "本文 2"]) {
      await generateText({ model, system: `${stable}\n\n<knowledge>\n${k}\n</knowledge>`, messages: [{ role: "user", content: "質問" }] });
    }
    expect(bodies[0].system?.[0]).toEqual(bodies[1].system?.[0]);
    expect(bodies[0].system?.[1].text).not.toBe(bodies[1].system?.[1].text);
  });

  it("題の一覧の後ろに何も無ければ分けない", async () => {
    const { model, bodies } = capture(true);
    await generateText({ model, system: "指示文\n\n<wiki-index>\n- **題 A**\n</wiki-index>\n", messages: [{ role: "user", content: "質問" }] });
    expect(bodies[0].system).toHaveLength(1);
    expect(lastSystem(bodies[0])?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("分けたブロックと自動キャッシュを合わせても目印は 3 つ（上限 4 つ以内）", async () => {
    const { model, bodies } = capture(true);
    await generateText({
      model,
      system: "指示文\n\n<wiki-index>\n- **題 A**\n</wiki-index>\n\n<knowledge>\n本文\n</knowledge>",
      messages: [{ role: "user", content: "質問" }],
      tools: { echo },
      stopWhen: stepCountIs(1),
    });
    expect(JSON.stringify(bodies[0]).match(/cache_control/g)).toHaveLength(3);
  });

  it("公式 API かどうかをホスト名で見分ける", () => {
    expect(isOfficialAnthropicBase("https://api.anthropic.com/v1")).toBe(true);
    expect(isOfficialAnthropicBase("https://proxy.example.com/v1")).toBe(false);
    expect(isOfficialAnthropicBase("not a url")).toBe(false);
  });
});
