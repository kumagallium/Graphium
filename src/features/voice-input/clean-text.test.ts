import { describe, it, expect } from "vitest";
import { appendVoiceText, cleanVoiceText } from "./clean-text";

describe("cleanVoiceText", () => {
  it("前後の空白と末尾の句読点を取る", () => {
    expect(cleanVoiceText("  今日の予定を教えて。 ")).toBe("今日の予定を教えて");
    expect(cleanVoiceText("What is this?")).toBe("What is this");
    expect(cleanVoiceText("すごい！！")).toBe("すごい");
  });
  it("文中の句読点は残す", () => {
    expect(cleanVoiceText("まず、これを見て。次に、あれ。")).toBe("まず、これを見て。次に、あれ");
  });
  it("先頭の言いよどみを後ろの読点ごと取る", () => {
    expect(cleanVoiceText("えっと、会議の要約")).toBe("会議の要約");
    expect(cleanVoiceText("えーと 会議の要約")).toBe("会議の要約");
    expect(cleanVoiceText("あのー、これ")).toBe("これ");
    expect(cleanVoiceText("Um, summarize this")).toBe("summarize this");
  });
  it("末尾の言いよどみを取る", () => {
    expect(cleanVoiceText("会議の要約、えー")).toBe("会議の要約");
    expect(cleanVoiceText("summarize this uh.")).toBe("summarize this");
  });
  it("単語の一部は取らない", () => {
    expect(cleanVoiceText("error handling")).toBe("error handling");
    expect(cleanVoiceText("umbrella")).toBe("umbrella");
  });
  it("連続空白は 1 つに", () => {
    expect(cleanVoiceText("a   b\n c")).toBe("a b c");
  });
  it("結果が空なら空文字", () => {
    expect(cleanVoiceText("")).toBe("");
    expect(cleanVoiceText("  。 ")).toBe("");
    expect(cleanVoiceText("えっと、")).toBe("");
  });
});

describe("appendVoiceText", () => {
  it("空ならそのまま、あれば空白でつなぐ", () => {
    expect(appendVoiceText("", "a")).toBe("a");
    expect(appendVoiceText("x", "a")).toBe("x a");
  });
});
