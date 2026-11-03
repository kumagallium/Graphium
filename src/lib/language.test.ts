import { describe, it, expect } from "vitest";
import { generationLanguageName, normalizeGenerationLanguage, toGenerationLanguage } from "./language";

describe("toGenerationLanguage()", () => {
  it("ja / en はそのまま", () => {
    expect(toGenerationLanguage("ja")).toBe("ja");
    expect(toGenerationLanguage("en")).toBe("en");
  });

  it("ko も生成言語としてそのまま", () => {
    expect(toGenerationLanguage("ko")).toBe("ko");
  });

  it("不明な値は en", () => {
    expect(toGenerationLanguage("")).toBe("en");
    expect(toGenerationLanguage("xx")).toBe("en");
  });
});

describe("generationLanguageName()", () => {
  it("プロンプトに書く英語の言語名", () => {
    expect(generationLanguageName("ja")).toBe("Japanese");
    expect(generationLanguageName("en")).toBe("English");
    expect(generationLanguageName("ko")).toBe("Korean");
    expect(generationLanguageName("fr")).toBe("English");
  });
});

describe("normalizeGenerationLanguage()", () => {
  it("対応外・不明な値は fallback に寄せる", () => {
    expect(normalizeGenerationLanguage("ko")).toBe("ko");
    expect(normalizeGenerationLanguage("fr")).toBe("en");
    expect(normalizeGenerationLanguage(undefined, "ja")).toBe("ja");
  });
});
