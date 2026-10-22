import { describe, it, expect, vi } from "vitest";
import { fetchLoadedContext, isLocalApiBase, isLocalCapacityError } from "./local-model";
import { estimateTokens, requiredContext } from "../../lib/context-estimate";

describe("isLocalApiBase", () => {
  it("ループバックだけをローカルとみなす", () => {
    expect(isLocalApiBase("http://localhost:1234/v1")).toBe(true);
    expect(isLocalApiBase("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isLocalApiBase("http://[::1]:1234/v1")).toBe(true);
    expect(isLocalApiBase("https://api.openai.com/v1")).toBe(false);
    expect(isLocalApiBase("http://192.168.1.5:1234/v1")).toBe(false);
    expect(isLocalApiBase(undefined)).toBe(false);
    expect(isLocalApiBase("not a url")).toBe(false);
  });
});

describe("isLocalCapacityError", () => {
  it("LM Studio の Channel Error と、文脈の長さの失敗を見分ける（cause・本文も見る）", () => {
    expect(isLocalCapacityError(new Error("Error: Channel Error"))).toBe(true);
    expect(isLocalCapacityError({ message: "Bad Request", responseBody: '{"error":"failed to decode, ret = 1"}' })).toBe(true);
    expect(isLocalCapacityError({ message: "x", cause: new Error("the request exceeds the available context size") })).toBe(true);
    expect(isLocalCapacityError(new Error("prompt is longer than the context length (n_ctx)"))).toBe(true);
    expect(isLocalCapacityError(new Error("fetch failed"))).toBe(false);
    expect(isLocalCapacityError(new Error("Unauthorized"))).toBe(false);
  });
});

describe("fetchLoadedContext", () => {
  const reply = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);
  it("LM Studio の /api/v0/models から、読み込み中のそのモデルの長さを読む", async () => {
    const f = reply({
      data: [
        { id: "other", state: "loaded", loaded_context_length: 4096 },
        { id: "google/gemma-4-31b-qat", state: "loaded", loaded_context_length: 8192, max_context_length: 262144 },
      ],
    });
    expect(await fetchLoadedContext("http://localhost:1234/v1", "google/gemma-4-31b-qat", f)).toBe(8192);
    expect(f).toHaveBeenCalledWith("http://localhost:1234/api/v0/models", expect.anything());
  });
  it("読み込まれていない・見つからない・LM Studio でない・失敗は null", async () => {
    expect(await fetchLoadedContext("http://localhost:1234/v1", "m", reply({ data: [{ id: "m", state: "not-loaded" }] }))).toBeNull();
    expect(await fetchLoadedContext("http://localhost:1234/v1", "m", reply({ data: [] }))).toBeNull();
    expect(await fetchLoadedContext("http://localhost:11434/v1", "m", reply({}, false))).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await fetchLoadedContext("http://localhost:1234/v1", "m", boom as unknown as typeof fetch)).toBeNull();
  });
});

describe("見積もり", () => {
  it("漢字かなは多め、英数字は少なめに数える", () => {
    expect(estimateTokens("あいう")).toBe(3); // 0.7 × 3 = 2.1 → 3
    expect(estimateTokens("abcdefghij")).toBe(3);
  });
  it("清書は入力の 2 倍、要約は入力の分に余白を足し、1,024 単位で切り上げる", () => {
    expect(requiredContext("cleanup", 3000)).toBe(12288); // 6000 + 6144 = 12144
    expect(requiredContext("summary", 30000)).toBe(36864); // 30000 + 6144 = 36144
  });
});

describe("isContextOverflowError", () => {
  it("ローカルとクラウドの「一度に扱える量を超えた」言い回しを拾う", async () => {
    const { isContextOverflowError } = await import("./local-model.ts");
    for (const message of [
      "Input length (230346) exceeds model's maximum context length (131072).",
      "This model's maximum context length is 131072 tokens.",
      "context_length_exceeded",
      "prompt is too long: 210000 tokens > 200000 maximum",
      "Request too large for gpt-oss-120b",
    ]) {
      expect(isContextOverflowError(new Error(message)), message).toBe(true);
    }
  });

  it("ほかの失敗は拾わない", async () => {
    const { isContextOverflowError } = await import("./local-model.ts");
    for (const message of ["Upstream error 502 Bad Gateway", "Invalid API key", "rate limit exceeded"]) {
      expect(isContextOverflowError(new Error(message)), message).toBe(false);
    }
  });
});
