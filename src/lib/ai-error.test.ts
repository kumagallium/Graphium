// @vitest-environment jsdom
// クライアント側 AI エラーヘルパーのテスト
// - localizeAiError: code → i18n 文言 / code 無しはメッセージそのまま（グレースフルデグラデーション）
// - aiErrorFromResponse: レスポンス JSON { error, code } → code 付き Error

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { syncLocale } from "../i18n";
import {
  localizeAiError,
  aiErrorFromResponse,
  COPILOT_AUTH_EXPIRED_EVENT,
  getCopilotAuthExpired,
  setCopilotAuthExpired,
  subscribeCopilotAuthExpired,
  resetCopilotAuthExpiredForTest,
} from "./ai-error";
import { CodedError } from "./ai-error-codes";

beforeEach(() => {
  syncLocale("en");
});

describe("localizeAiError", () => {
  it("NO_MODEL_REGISTERED は i18n 文言（en）に変換される", () => {
    const err = new CodedError("No AI model is registered.", "NO_MODEL_REGISTERED");
    expect(localizeAiError(err)).toBe(
      "No usable AI model was found. Add a model, or choose a different one, in Settings → AI.",
    );
  });

  it("ロケール ja では日本語文言になる", () => {
    syncLocale("ja");
    const err = new CodedError("No AI model is registered.", "NO_MODEL_REGISTERED");
    expect(localizeAiError(err)).toContain("使える AI モデルが見つかりませんでした");
  });

  it("COPILOT_SUBSCRIPTION_AUTH_EXPIRED / INVALID_API_KEY もそれぞれのキーに解決される", () => {
    syncLocale("ja");
    expect(
      localizeAiError(new CodedError("x", "COPILOT_SUBSCRIPTION_AUTH_EXPIRED")),
    ).toContain("ログイン");
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
      "No usable AI model was found. Add a model, or choose a different one, in Settings → AI.",
    );
  });

  it("code 無しの旧形式 { error } はメッセージだけの Error になる", async () => {
    const res = new Response(JSON.stringify({ error: "old style message" }), { status: 500 });
    const err = await aiErrorFromResponse(res, "fallback");
    expect(err.message).toBe("old style message");
    expect((err as Error & { code?: string }).code).toBeUndefined();
  });

  it("JSON でないレスポンスは fallback + 生ボディ先頭を診断用に残す", async () => {
    // 孤児 sidecar が返す 404 HTML 等の切り分け材料を落とさない
    const res = new Response("<html>gateway error</html>", { status: 502 });
    const err = await aiErrorFromResponse(res, "Ingest failed (502)");
    expect(err.message).toBe("Ingest failed (502): <html>gateway error</html>");
  });

  it("空ボディのレスポンスは fallback メッセージのみになる", async () => {
    const res = new Response("", { status: 502 });
    const err = await aiErrorFromResponse(res, "Ingest failed (502)");
    expect(err.message).toBe("Ingest failed (502)");
  });
});

describe("Copilot ログイン切れの検知", () => {
  const expired = () => new CodedError("x", "COPILOT_SUBSCRIPTION_AUTH_EXPIRED");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    resetCopilotAuthExpiredForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const listen = () => {
    const fn = vi.fn();
    window.addEventListener(COPILOT_AUTH_EXPIRED_EVENT, fn);
    return { fn, off: () => window.removeEventListener(COPILOT_AUTH_EXPIRED_EVENT, fn) };
  };

  it("コードが一致したときだけ dispatch し、フラグを立てる", () => {
    const { fn, off } = listen();
    localizeAiError(new CodedError("x", "INVALID_API_KEY"));
    localizeAiError(new Error("plain"));
    expect(fn).not.toHaveBeenCalled();
    expect(getCopilotAuthExpired()).toBe(false);
    localizeAiError(expired());
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getCopilotAuthExpired()).toBe(true);
    off();
  });

  it("60 秒に 1 回に抑える（フラグは毎回立つ）", () => {
    const { fn, off } = listen();
    localizeAiError(expired());
    localizeAiError(expired());
    vi.advanceTimersByTime(59_000);
    localizeAiError(expired());
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_500);
    localizeAiError(expired());
    expect(fn).toHaveBeenCalledTimes(2);
    off();
  });

  it("フラグの変化を購読者へ通知する", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCopilotAuthExpired(listener);
    setCopilotAuthExpired(true);
    setCopilotAuthExpired(true);
    setCopilotAuthExpired(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
