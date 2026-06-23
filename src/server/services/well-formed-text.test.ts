// well-formed-text のユニットテスト
//
// lone surrogate（壊れたサロゲートペア）を U+FFFD に置換し、正常な文字列・絵文字は
// 一切壊さないことを検証する。これが Anthropic API の「no low surrogate in string」400 を防ぐ。

import { describe, it, expect } from "vitest";
import type { ModelMessage } from "ai";
import { toWellFormed, sanitizeMessages } from "./well-formed-text.js";

const REPLACEMENT = "�";

describe("toWellFormed", () => {
  it("通常の ASCII / 日本語はそのまま返す", () => {
    expect(toWellFormed("hello world")).toBe("hello world");
    expect(toWellFormed("実験ノート")).toBe("実験ノート");
  });

  it("正常な絵文字（サロゲートペア）は壊さない", () => {
    const rocket = "🚀"; // U+1F680 = high+low サロゲートペア
    expect(toWellFormed(`go ${rocket} now`)).toBe(`go ${rocket} now`);
  });

  it("lone high surrogate を U+FFFD に置換する", () => {
    const broken = "ab\uD83D"; // 🚀 の high 側だけが残った状態（文字数で切り詰めた典型）
    const result = toWellFormed(broken);
    expect(result).toBe(`ab${REPLACEMENT}`);
    // 置換後に lone surrogate が一切残らないこと
    expect(/[\uD800-\uDFFF]/.test(result)).toBe(false);
  });

  it("lone low surrogate を U+FFFD に置換する", () => {
    const broken = "\uDE80cd"; // low 側だけが先頭に残った状態
    expect(toWellFormed(broken)).toBe(`${REPLACEMENT}cd`);
  });

  it("置換後の文字列は JSON.stringify → Anthropic 相当の検証を通る（lone surrogate を含まない）", () => {
    const broken = "long note ... \uD83Dtail";
    const serialized = JSON.stringify({ text: toWellFormed(broken) });
    // \ud800-\udfff の単独エスケープが残っていないこと
    expect(/\\u(d[89ab][0-9a-f]{2})/i.test(serialized)).toBe(false);
  });
});

describe("sanitizeMessages", () => {
  it("string content の lone surrogate を置換する", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "note \uD83D end" },
    ];
    const out = sanitizeMessages(messages);
    expect(out[0].content).toBe(`note ${REPLACEMENT} end`);
  });

  it("配列 content の text part をサニタイズし、他の part はそのまま残す", () => {
    const messages: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "broken \uDE80" },
          { type: "text", text: "正常" },
        ],
      },
    ];
    const out = sanitizeMessages(messages);
    const parts = out[0].content as Array<{ type: string; text: string }>;
    expect(parts[0].text).toBe(`broken ${REPLACEMENT}`);
    expect(parts[1].text).toBe("正常");
  });

  it("元の配列・オブジェクトを破壊的に変更しない", () => {
    const original: ModelMessage[] = [{ role: "user", content: "x \uD83D" }];
    sanitizeMessages(original);
    expect(original[0].content).toBe("x \uD83D");
  });
});
