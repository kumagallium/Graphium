import { describe, it, expect } from "vitest";
import { toGenerationLanguage } from "./language";

describe("toGenerationLanguage()", () => {
  it("ja / en はそのまま", () => {
    expect(toGenerationLanguage("ja")).toBe("ja");
    expect(toGenerationLanguage("en")).toBe("en");
  });

  it("生成に未対応の UI 言語（ko）は en に寄せる", () => {
    expect(toGenerationLanguage("ko")).toBe("en");
  });

  it("不明な値は en", () => {
    expect(toGenerationLanguage("")).toBe("en");
    expect(toGenerationLanguage("xx")).toBe("en");
  });
});
