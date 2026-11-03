import { describe, expect, it } from "vitest";
import { modelAcceptsImages } from "./model-vision";

describe("modelAcceptsImages", () => {
  it("Anthropic・Google・Copilot は読める", () => {
    expect(modelAcceptsImages({ provider: "anthropic", modelId: "claude-sonnet-5-5" })).toBe(true);
    expect(modelAcceptsImages({ provider: "google", modelId: "gemini-3-pro" })).toBe(true);
    expect(modelAcceptsImages({ provider: "copilot-subscription", modelId: "gpt-5" })).toBe(true);
  });

  it("OpenAI 公式は古い文字だけの系列を外す", () => {
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-5" })).toBe(true);
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-3.5-turbo" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai", modelId: "o3-mini" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-4" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-4-0613" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-4-turbo" })).toBe(true);
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-4o-mini" })).toBe(true);
  });

  it("互換サーバーは名前に画像対応の系列があるときだけ", () => {
    expect(modelAcceptsImages({ provider: "openai-compatible", modelId: "gpt-oss-120b", apiBase: "https://x" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai-compatible", modelId: "llama-3.1-8b" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai-compatible", modelId: "qwen2.5-vl-7b-instruct" })).toBe(true);
    expect(modelAcceptsImages({ provider: "openai-compatible", modelId: "google/gemma-3-12b" })).toBe(true);
    // apiBase 付きの openai も互換サーバー扱い
    expect(modelAcceptsImages({ provider: "openai", modelId: "gpt-oss-120b", apiBase: "https://x" })).toBe(false);
    expect(modelAcceptsImages({ provider: "openai", modelId: "llava-1.6", apiBase: "http://localhost:1234/v1" })).toBe(true);
  });

  it("不明・未指定は読めない扱い", () => {
    expect(modelAcceptsImages(undefined)).toBe(false);
    expect(modelAcceptsImages({ provider: "something", modelId: "x" })).toBe(false);
  });
});
