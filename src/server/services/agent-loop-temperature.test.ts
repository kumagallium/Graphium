// 温度の指定を拒むモデル（Claude Opus 5 など）でも、清書・要約・翻訳が失敗しないこと。
// 拒まれたら温度なしで 1 回だけやり直し、以後そのモデルには温度を送らない。

import { beforeEach, describe, expect, it } from "vitest";
import { isTemperatureRejectedError, resetTemperatureRejectedModelsForTest, runAgentLoop } from "./agent-loop.js";

/** temperature が来たら Anthropic と同じ文言で拒み、来なければテキストを返すダミーモデル */
function makeModel() {
  const temps: Array<number | undefined> = [];
  const model = {
    specificationVersion: "v3",
    provider: "test",
    modelId: "no-temp",
    supportedUrls: {},
    doGenerate: async (options: { temperature?: number }) => {
      temps.push(options.temperature);
      if (options.temperature !== undefined) throw new Error("`temperature` is deprecated for this model.");
      return {
        content: [{ type: "text" as const, text: "ok" }],
        finishReason: "stop" as const,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        warnings: [],
      };
    },
    doStream: async () => {
      throw new Error("not used");
    },
  };
  return { model, temps };
}

const CONFIG = { id: "m1", name: "opus", provider: "anthropic", modelId: "no-temp", apiKey: "k", apiBase: null } as never;

describe("温度を拒むモデル", () => {
  beforeEach(() => resetTemperatureRejectedModelsForTest());

  it("拒まれたら温度なしでやり直して成功し、次からは最初から送らない", async () => {
    const { model, temps } = makeModel();
    const run = () =>
      runAgentLoop({
        model: model as never,
        modelId: "no-temp",
        systemPrompt: "s",
        messages: [{ role: "user", content: "hi" }],
        maxSteps: 1,
        modelConfig: CONFIG,
        temperature: 0,
      });
    expect((await run()).message).toBe("ok");
    expect(temps).toEqual([0, undefined]);
    expect((await run()).message).toBe("ok");
    expect(temps).toEqual([0, undefined, undefined]);
  });

  it("温度と関係のないエラーはやり直さずに投げる", async () => {
    expect(isTemperatureRejectedError(new Error("rate limit"))).toBe(false);
    expect(isTemperatureRejectedError(new Error("`temperature` is deprecated for this model."))).toBe(true);
    expect(isTemperatureRejectedError({ message: "Bad Request", cause: { message: "temperature is not supported" } })).toBe(true);
  });
});
