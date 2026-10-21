// このパソコンで動くモデル（LM Studio など）が文脈の枠不足で落ちたとき、
// 「Channel Error」のままでなく、設定の見直しを案内するコードに変えること

import { describe, expect, it } from "vitest";
import { runAgentLoop } from "./agent-loop.js";
import { aiErrorCodeOf } from "../../lib/ai-error-codes.js";

function failingModel(message: string) {
  return {
    specificationVersion: "v3",
    provider: "test",
    modelId: "gemma",
    supportedUrls: {},
    doGenerate: async () => {
      throw new Error(message);
    },
    doStream: async () => {
      throw new Error("not used");
    },
  };
}

const run = (message: string, apiBase: string | null) =>
  runAgentLoop({
    model: failingModel(message) as never,
    modelId: "gemma",
    systemPrompt: "s",
    messages: [{ role: "user", content: "hi" }],
    maxSteps: 1,
    modelConfig: { id: "m1", name: "gemma", provider: "openai-compatible", modelId: "gemma", apiKey: "", apiBase } as never,
  });

describe("ローカルのモデルの枠不足", () => {
  it("ループバックのモデルの Channel Error は LOCAL_MODEL_CAPACITY に", async () => {
    const err = await run("Error: Channel Error", "http://localhost:1234/v1").catch((e) => e);
    expect(aiErrorCodeOf(err)).toBe("LOCAL_MODEL_CAPACITY");
  });
  it("クラウドのモデル・関係のない失敗はそのまま", async () => {
    expect(aiErrorCodeOf(await run("Error: Channel Error", "https://example.com/v1").catch((e) => e))).toBeUndefined();
    const other = await run("fetch failed", "http://localhost:1234/v1").catch((e) => e);
    expect(aiErrorCodeOf(other)).toBeUndefined();
    expect(other.message).toBe("fetch failed");
  });
});
