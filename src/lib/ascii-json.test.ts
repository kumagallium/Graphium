import { describe, expect, it } from "vitest";
import { toAsciiJson } from "./ascii-json";

describe("toAsciiJson", () => {
  it("ASCII だけの値は JSON.stringify と同じ", () => {
    const v = { provider: "anthropic", modelId: "claude", apiKey: "sk-1", apiBase: null };
    expect(toAsciiJson(v)).toBe(JSON.stringify(v));
  });

  it("日本語・絵文字を \\uXXXX に逃がし、出力は ISO-8859-1 に収まる", () => {
    const v = { name: "GitHub Copilot（サブスクリプション）", servers: [{ name: "星 ⭐ 😀" }] };
    const s = toAsciiJson(v);
    expect(/^[\u0000-\u007f]*$/.test(s)).toBe(true);
    // ヘッダー値として fetch に渡せる（ISO-8859-1 の範囲外が無い）
    expect(() => new Headers({ "X-Test": s })).not.toThrow();
  });

  it("JSON.parse で元の値に戻る（受け側は無変更でよい）", () => {
    const v = { name: "GitHub Copilot（サブスクリプション）", emoji: "😀", nested: { ja: "日本語" } };
    expect(JSON.parse(toAsciiJson(v))).toEqual(v);
  });
});
