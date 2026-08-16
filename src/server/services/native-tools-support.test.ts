import { describe, it, expect, beforeEach } from "vitest";
import {
  nativeToolsCacheKey,
  getNativeToolsVerdict,
  setNativeToolsVerdict,
  resetNativeToolsVerdicts,
  isToolsUnsupportedError,
} from "./native-tools-support.js";

describe("nativeToolsCacheKey", () => {
  it("provider / apiBase / modelId の組で区別する", () => {
    const a = nativeToolsCacheKey({
      provider: "openai-compatible",
      apiBase: "https://api.ai.sakura.ad.jp/v1",
      modelId: "gpt-oss-120b",
    });
    const b = nativeToolsCacheKey({
      provider: "openai-compatible",
      apiBase: "http://localhost:11434/v1",
      modelId: "gpt-oss-120b",
    });
    expect(a).not.toBe(b);
  });

  it("同じ endpoint / モデルなら同じキーになる", () => {
    const input = { provider: "openai-compatible", apiBase: "https://x/v1", modelId: "kimi-k2.5" };
    expect(nativeToolsCacheKey(input)).toBe(nativeToolsCacheKey({ ...input }));
  });

  it("未指定フィールドがあってもキーを作れる", () => {
    expect(nativeToolsCacheKey({})).toBe("||");
  });
});

describe("verdict キャッシュ", () => {
  beforeEach(() => resetNativeToolsVerdicts());

  it("未探索は unknown", () => {
    expect(getNativeToolsVerdict("k")).toBe("unknown");
  });

  it("記録した判定を返す", () => {
    setNativeToolsVerdict("k", "supported");
    expect(getNativeToolsVerdict("k")).toBe("supported");
    setNativeToolsVerdict("k", "unsupported");
    expect(getNativeToolsVerdict("k")).toBe("unsupported");
  });

  it("reset で消える", () => {
    setNativeToolsVerdict("k", "unsupported");
    resetNativeToolsVerdicts();
    expect(getNativeToolsVerdict("k")).toBe("unknown");
  });
});

describe("isToolsUnsupportedError", () => {
  it("tools を知らない 400 は非対応と判定する", () => {
    const err = {
      name: "AI_APICallError",
      statusCode: 400,
      message: "Unrecognized request argument supplied: tools",
    };
    expect(isToolsUnsupportedError(err)).toBe(true);
  });

  it("function calling 非対応を明示する 400 も拾う", () => {
    const err = {
      statusCode: 400,
      responseBody: JSON.stringify({
        error: { message: "This model does not support function calling" },
      }),
    };
    expect(isToolsUnsupportedError(err)).toBe(true);
  });

  it("AI SDK の UnsupportedFunctionality エラーは無条件で拾う", () => {
    expect(isToolsUnsupportedError({ name: "AI_UnsupportedFunctionalityError" })).toBe(true);
  });

  it("cause に包まれていても辿る", () => {
    const err = {
      name: "AI_APICallError",
      message: "request failed",
      cause: { statusCode: 400, message: "unknown parameter: tool_choice" },
    };
    expect(isToolsUnsupportedError(err)).toBe(true);
  });

  it("認証エラーは対象外", () => {
    const err = { statusCode: 401, message: "invalid api key for tools endpoint" };
    expect(isToolsUnsupportedError(err)).toBe(false);
  });

  it("レート制限は対象外", () => {
    expect(isToolsUnsupportedError({ statusCode: 429, message: "rate limit" })).toBe(false);
  });

  it("サーバー障害は対象外", () => {
    const err = { statusCode: 503, message: "tools backend unavailable" };
    expect(isToolsUnsupportedError(err)).toBe(false);
  });

  it("中断は対象外", () => {
    expect(isToolsUnsupportedError({ name: "AbortError", message: "aborted" })).toBe(false);
  });

  it("tools に言及しない 400 は対象外", () => {
    const err = { statusCode: 400, message: "context length exceeded" };
    expect(isToolsUnsupportedError(err)).toBe(false);
  });

  it("ツール引数がおかしいだけの失敗は対象外（endpoint は tools を理解している）", () => {
    const err = { statusCode: 400, message: "tool call failed: the model produced malformed json" };
    expect(isToolsUnsupportedError(err)).toBe(false);
  });

  it("null / undefined は false", () => {
    expect(isToolsUnsupportedError(null)).toBe(false);
    expect(isToolsUnsupportedError(undefined)).toBe(false);
  });
});
