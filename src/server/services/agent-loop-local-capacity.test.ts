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
    const other = await run("Unexpected token in JSON at position 3 of the tool arguments", "http://localhost:1234/v1").catch((e) => e);
    expect(aiErrorCodeOf(other)).toBeUndefined();
    expect(other.message).toBe("Unexpected token in JSON at position 3 of the tool arguments");
  });
});

describe("ローカルのモデルが応答しない・読み込めない", () => {
  const local = "http://127.0.0.1:1234/v1";
  it.each([
    "Failed to load model \"qwen3.5-9b\". Error: Operation canceled.",
    "Bad Request",
    "Internal Server Error",
    "Failed after 3 attempts. Last error: Internal Server Error",
    "fetch failed",
  ])("「%s」は LOCAL_MODEL_UNAVAILABLE に", async (message) => {
    const err = await run(message, local).catch((e) => e);
    expect(aiErrorCodeOf(err)).toBe("LOCAL_MODEL_UNAVAILABLE");
  });
  it("文脈の枠不足は LOCAL_MODEL_CAPACITY のまま", async () => {
    expect(aiErrorCodeOf(await run("Error: Channel Error", local).catch((e) => e))).toBe("LOCAL_MODEL_CAPACITY");
  });
  it("クラウドの Bad Request はそのまま", async () => {
    expect(aiErrorCodeOf(await run("Bad Request", "https://api.example.com/v1").catch((e) => e))).toBeUndefined();
  });
});
