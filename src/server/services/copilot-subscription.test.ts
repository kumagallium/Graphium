import { describe, it, expect } from "vitest";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import {
  flattenPromptForCopilot,
  mapCopilotFinishReason,
  mapCopilotUsage,
  resolveCopilotModelId,
} from "./copilot-subscription.js";

describe("resolveCopilotModelId", () => {
  it("空・default は CLI 既定モデル（undefined）に写す", () => {
    expect(resolveCopilotModelId(undefined)).toBeUndefined();
    expect(resolveCopilotModelId("")).toBeUndefined();
    expect(resolveCopilotModelId("  ")).toBeUndefined();
    expect(resolveCopilotModelId("default")).toBeUndefined();
  });

  it("実モデル ID はそのまま返す", () => {
    expect(resolveCopilotModelId("claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
    expect(resolveCopilotModelId(" gpt-5 ")).toBe("gpt-5");
  });
});

describe("mapCopilotFinishReason", () => {
  it("OpenAI 語彙を AI SDK の unified 表現へ写す", () => {
    expect(mapCopilotFinishReason("stop")).toEqual({ unified: "stop", raw: "stop" });
    expect(mapCopilotFinishReason("length")).toEqual({ unified: "length", raw: "length" });
    expect(mapCopilotFinishReason("content_filter")).toEqual({
      unified: "content-filter",
      raw: "content_filter",
    });
    expect(mapCopilotFinishReason("tool_calls")).toEqual({
      unified: "tool-calls",
      raw: "tool_calls",
    });
  });

  it("未知・未指定は安全側に倒す", () => {
    expect(mapCopilotFinishReason(undefined).unified).toBe("stop");
    expect(mapCopilotFinishReason("weird").unified).toBe("other");
  });
});

describe("mapCopilotUsage", () => {
  it("トークン数を v3 Usage 形へ写す", () => {
    const usage = mapCopilotUsage({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
    });
    expect(usage.inputTokens.total).toBe(100);
    expect(usage.inputTokens.cacheRead).toBe(30);
    expect(usage.outputTokens.total).toBe(20);
  });

  it("usage イベント欠落時は undefined のまま返す", () => {
    const usage = mapCopilotUsage(undefined);
    expect(usage.inputTokens.total).toBeUndefined();
    expect(usage.outputTokens.total).toBeUndefined();
    expect(usage.raw).toBeUndefined();
  });
});

describe("flattenPromptForCopilot", () => {
  it("system は分離し、単一 user はラベル無しでそのまま送る", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "You are a translator." },
      { role: "user", content: [{ type: "text", text: "こんにちは" }] },
    ];
    const result = flattenPromptForCopilot(prompt);
    expect(result.system).toBe("You are a translator.");
    expect(result.promptText).toBe("こんにちは");
    expect(result.warnings).toEqual([]);
  });

  it("複数 system は連結する", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    expect(flattenPromptForCopilot(prompt).system).toBe("A\n\nB");
  });

  it("複数ターンはラベル付きトランスクリプトにする", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "1+1は?" }] },
      { role: "assistant", content: [{ type: "text", text: "2です" }] },
      { role: "user", content: [{ type: "text", text: "では2+2は?" }] },
    ];
    const result = flattenPromptForCopilot(prompt);
    expect(result.promptText).toBe(
      "User: 1+1は?\n\nAssistant: 2です\n\nUser: では2+2は?",
    );
  });

  it("system が無ければ undefined を返す", () => {
    const prompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ];
    expect(flattenPromptForCopilot(prompt).system).toBeUndefined();
  });

  it("テキスト以外のパートは落として warning にする", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "user",
        content: [
          { type: "text", text: "この画像を見て" },
          {
            type: "file",
            mediaType: "image/png",
            data: new Uint8Array([1, 2, 3]),
          },
        ],
      },
    ];
    const result = flattenPromptForCopilot(prompt);
    expect(result.promptText).toBe("この画像を見て");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe("other");
  });
});
