import { describe, it, expect } from "vitest";
import { describeAuthError } from "./agent-loop.js";

describe("describeAuthError", () => {
  it("claude-subscription の 401 は再ログイン導線を返す", () => {
    // 実際にユーザーが踏んだエラー文言（Claude Code CLI の OAuth 切れ）
    const err = new Error(
      'Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
    );
    const msg = describeAuthError(err, "claude-subscription");
    expect(msg).not.toBeNull();
    expect(msg).toContain("再ログイン");
    expect(msg).toContain("claude");
  });

  it("anthropic 等の 401 は API キー確認の導線を返す", () => {
    const err = Object.assign(new Error("Unauthorized"), { statusCode: 401 });
    const msg = describeAuthError(err, "anthropic");
    expect(msg).not.toBeNull();
    expect(msg).toContain("API キー");
    // サブスク向け文言は混ざらない
    expect(msg).not.toContain("再ログイン");
  });

  it("statusCode 401 のオブジェクトも認証エラーと判定する", () => {
    expect(describeAuthError({ statusCode: 401 }, "openai-compatible")).not.toBeNull();
  });

  it("認証と無関係なエラーは null（＝元エラーをそのまま投げ直す）", () => {
    expect(describeAuthError(new Error("network timeout"), "anthropic")).toBeNull();
    expect(describeAuthError(new Error("rate_limit_error 429"), "anthropic")).toBeNull();
  });
});
