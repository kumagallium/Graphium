// クライアント側 AI エラーヘルパーのテスト
// - localizeAiError: code → i18n 文言 / code 無しはメッセージそのまま（グレースフルデグラデーション）
// - aiErrorFromResponse: レスポンス JSON { error, code } → code 付き Error

import { describe, it, expect, beforeEach } from "vitest";
import { syncLocale } from "../i18n";
import { localizeAiError, aiErrorFromResponse } from "./ai-error";
import { CodedError } from "./ai-error-codes";

beforeEach(() => {
  syncLocale("en");
});

describe("localizeAiError", () => {
  it("NO_MODEL_REGISTERED は i18n 文言（en）に変換される", () => {
    const err = new CodedError("No AI model is registered.", "NO_MODEL_REGISTERED");
    expect(localizeAiError(err)).toBe(
      "No AI model is registered. Add a model in Settings → AI Setup.",
    );
  });

  it("ロケール ja では日本語文言になる", () => {
    syncLocale("ja");
    const err = new CodedError("No AI model is registered.", "NO_MODEL_REGISTERED");
    expect(localizeAiError(err)).toContain("AI モデルが登録されていません");
  });

  it("SUBSCRIPTION_AUTH_EXPIRED / INVALID_API_KEY もそれぞれのキーに解決される", () => {
    syncLocale("ja");
    expect(
      localizeAiError(new CodedError("x", "SUBSCRIPTION_AUTH_EXPIRED")),
    ).toContain("再ログイン");
    expect(localizeAiError(new CodedError("x", "INVALID_API_KEY"))).toContain(
      "API キー",
    );
  });

  it("code の無い Error はサーバーメッセージをそのまま出す（旧サーバー互換）", () => {
    expect(localizeAiError(new Error("Provider API error (429): rate limited"))).toBe(
      "Provider API error (429): rate limited",
    );
  });

  it("未知の code はメッセージそのまま（前方互換）", () => {
    const err = Object.assign(new Error("some new failure"), { code: "SOME_NEW_CODE" });
    expect(localizeAiError(err)).toBe("some new failure");
  });

  it("文字列エラーはそのまま、空はフォールバック文言", () => {
    expect(localizeAiError("plain string")).toBe("plain string");
    expect(localizeAiError(undefined)).toBe("AI request failed");
  });
});

describe("aiErrorFromResponse", () => {
  it("{ error, code } から code 付き Error を作る", async () => {
    const res = new Response(
      JSON.stringify({ error: "No AI model is registered.", code: "NO_MODEL_REGISTERED" }),
      { status: 400 },
    );
    const err = await aiErrorFromResponse(res, "fallback");
    expect(err.message).toBe("No AI model is registered.");
    expect((err as Error & { code?: string }).code).toBe("NO_MODEL_REGISTERED");
    // localizeAiError と組み合わせて i18n 文言になること（統合の要）
    expect(localizeAiError(err)).toBe(
      "No AI model is registered. Add a model in Settings → AI Setup.",
    );
  });

  it("code 無しの旧形式 { error } はメッセージだけの Error になる", async () => {
    const res = new Response(JSON.stringify({ error: "old style message" }), { status: 500 });
    const err = await aiErrorFromResponse(res, "fallback");
    expect(err.message).toBe("old style message");
    expect((err as Error & { code?: string }).code).toBeUndefined();
  });

  it("JSON でないレスポンスは fallback メッセージになる", async () => {
    const res = new Response("<html>gateway error</html>", { status: 502 });
    const err = await aiErrorFromResponse(res, "Ingest failed (502)");
    expect(err.message).toBe("Ingest failed (502)");
  });
});
