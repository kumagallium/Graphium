// AI エラーコード共有モジュールのテスト
// サーバー（ルートの errorBody / noModelRegisteredBody）とクライアント（aiErrorCodeOf）の
// 双方が依存する不変条件を固定する。

import { describe, it, expect } from "vitest";
import {
  CodedError,
  aiErrorCodeOf,
  errorBody,
  noModelRegisteredBody,
} from "./ai-error-codes";

describe("CodedError", () => {
  it("message と code を保持する", () => {
    const err = new CodedError("boom", "INVALID_API_KEY");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.code).toBe("INVALID_API_KEY");
  });
});

describe("aiErrorCodeOf", () => {
  it("CodedError から code を取り出す", () => {
    expect(aiErrorCodeOf(new CodedError("x", "NO_MODEL_REGISTERED"))).toBe(
      "NO_MODEL_REGISTERED",
    );
  });

  it("素の Error に code プロパティが載っていても既知のものだけ通す", () => {
    const known = Object.assign(new Error("x"), {
      code: "COPILOT_SUBSCRIPTION_AUTH_EXPIRED",
    });
    expect(aiErrorCodeOf(known)).toBe("COPILOT_SUBSCRIPTION_AUTH_EXPIRED");
    // Node の fs エラー等の無関係な code（ENOENT）は拾わない
    const unknown = Object.assign(new Error("x"), { code: "ENOENT" });
    expect(aiErrorCodeOf(unknown)).toBeUndefined();
  });

  it("null / undefined / code 無しは undefined", () => {
    expect(aiErrorCodeOf(null)).toBeUndefined();
    expect(aiErrorCodeOf(undefined)).toBeUndefined();
    expect(aiErrorCodeOf(new Error("x"))).toBeUndefined();
    expect(aiErrorCodeOf("string error")).toBeUndefined();
  });
});

describe("noModelRegisteredBody", () => {
  it("英語メッセージ + NO_MODEL_REGISTERED を返す（400 レスポンス用）", () => {
    const body = noModelRegisteredBody();
    expect(body.code).toBe("NO_MODEL_REGISTERED");
    expect(body.error).toContain("Settings");
    // 旧クライアント互換: error フィールドは必ず非空文字列
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("errorBody", () => {
  it("CodedError は { error, code } になる", () => {
    expect(errorBody(new CodedError("bad key", "INVALID_API_KEY"))).toEqual({
      error: "bad key",
      code: "INVALID_API_KEY",
    });
  });

  it("素の Error は code 無しの { error } になる（後方互換の形状）", () => {
    expect(errorBody(new Error("plain"))).toEqual({ error: "plain" });
  });

  it("Error 以外は fallback 文字列（string はそのまま採用）", () => {
    expect(errorBody("oops")).toEqual({ error: "oops" });
    expect(errorBody(42)).toEqual({ error: "Unknown error" });
    expect(errorBody(undefined, "fallback msg")).toEqual({ error: "fallback msg" });
  });
});
