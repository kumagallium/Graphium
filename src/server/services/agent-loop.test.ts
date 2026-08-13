import { describe, it, expect } from "vitest";
import { describeAuthError, runAgentLoop } from "./agent-loop.js";
import { aiErrorCodeOf } from "../../lib/ai-error-codes.js";

describe("describeAuthError", () => {
  it("copilot-subscription の 401 は再サインイン導線（英語）+ COPILOT_SUBSCRIPTION_AUTH_EXPIRED を返す", () => {
    const err = new Error(
      'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
    );
    const result = describeAuthError(err, "copilot-subscription");
    expect(result).not.toBeNull();
    expect(result!.code).toBe("COPILOT_SUBSCRIPTION_AUTH_EXPIRED");
    // ターミナルでの `copilot` 再サインイン導線が含まれること
    expect(result!.message).toContain("copilot");
    expect(result!.message.toLowerCase()).toContain("sign in");
  });

  it("anthropic 等の 401 は API キー確認の導線（英語）+ INVALID_API_KEY を返す", () => {
    const err = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const result = describeAuthError(err, "anthropic");
    expect(result).not.toBeNull();
    expect(result!.code).toBe("INVALID_API_KEY");
    expect(result!.message).toContain("API key");
    // サブスク向け文言は混ざらない
    expect(result!.message.toLowerCase()).not.toContain("subscription");
  });

  it("statusCode 401 のオブジェクトも認証エラーと判定する", () => {
    expect(describeAuthError({ statusCode: 401 }, "openai-compatible")).not.toBeNull();
  });

  it("認証と無関係なエラーは null（＝元エラーをそのまま投げ直す）", () => {
    expect(describeAuthError(new Error("network timeout"), "anthropic")).toBeNull();
    expect(describeAuthError(new Error("rate_limit_error 429"), "anthropic")).toBeNull();
  });
});

describe("runAgentLoop の認証エラー変換", () => {
  it("model が 401 を投げたら code 付き Error として投げ直す（ルートの errorBody が JSON へ通す）", async () => {
    // generateText に渡った時点で 401 相当のエラーを投げるダミーモデル
    const throwingModel = {
      specificationVersion: "v3",
      provider: "test",
      modelId: "test-model",
      supportedUrls: {},
      doGenerate: async () => {
        throw Object.assign(new Error("authentication_error"), { statusCode: 401 });
      },
      doStream: async () => {
        throw Object.assign(new Error("authentication_error"), { statusCode: 401 });
      },
    };
    await expect(
      runAgentLoop({
        // ダミーモデルは LanguageModel の実装詳細に依存しないよう any で流し込む
        model: throwingModel as never,
        modelId: "test-model",
        systemPrompt: "test",
        messages: [{ role: "user", content: "hi" }],
        modelConfig: {
          id: "m1",
          name: "test",
          provider: "copilot-subscription",
          modelId: "test-model",
          apiKey: "",
        } as never,
      }),
    ).rejects.toSatisfy((err: unknown) => {
      // 機械可読 code が載っていること（クライアントが i18n 変換の鍵にする）
      return aiErrorCodeOf(err) === "COPILOT_SUBSCRIPTION_AUTH_EXPIRED";
    });
  });
});
