import { describe, expect, it } from "vitest";
import { shouldGenerateChatTitle } from "./title";

describe("shouldGenerateChatTitle", () => {
  it("最初のやり取り（既存メッセージ0件・題未生成）では true", () => {
    expect(shouldGenerateChatTitle({ existingTitle: undefined, baseMessageCount: 0 })).toBe(true);
  });

  it("既に題が付いている会話では、最初のやり取りでも false", () => {
    expect(shouldGenerateChatTitle({ existingTitle: "既存の題", baseMessageCount: 0 })).toBe(false);
  });

  it("2 往復目以降（既存メッセージあり）では false", () => {
    expect(shouldGenerateChatTitle({ existingTitle: undefined, baseMessageCount: 2 })).toBe(false);
  });
});
