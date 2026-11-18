import { describe, it, expect } from "vitest";
import {
  conversationFileId,
  conversationSourceId,
  estimateConversationIngestTokens,
  isValidConversationSessionId,
  parseConversationFileId,
} from "./types";

const SID = "11111111-2222-4333-8444-555555555555";

describe("conversationFileId / parseConversationFileId", () => {
  it("往復する", () => {
    const id = conversationFileId("claude-code", SID);
    expect(id).toBe(`conv-claude-code-${SID}`);
    expect(parseConversationFileId(id as string)).toEqual({ provider: "claude-code", sessionId: SID });
  });

  it("下線とハイフンと 100 字ちょうどは通る", () => {
    expect(conversationFileId("claude-code", "a_b-c")).not.toBeNull();
    expect(conversationFileId("claude-code", "a".repeat(100))).not.toBeNull();
  });

  it.each([
    ["スラッシュ", "a/b"],
    ["..", ".."],
    ["親を含む", "../x"],
    ["コロン", "a:b"],
    ["空", ""],
    ["101 字", "a".repeat(101)],
    ["日本語", "こねた生地"],
  ])("sessionId が不正（%s）なら null", (_label, sid) => {
    expect(isValidConversationSessionId(sid)).toBe(false);
    expect(conversationFileId("claude-code", sid)).toBeNull();
  });

  it.each(["abc", "conv-unknown-x", "conv-claude-code-", "conv-claude-code-a/b", "conv-claude-code-a:b", ""])(
    "会話でない id（%j）は null",
    (id) => {
      expect(parseConversationFileId(id)).toBeNull();
    },
  );
});

describe("conversationSourceId", () => {
  it("conversation: を前に付ける", () => {
    expect(conversationSourceId(`conv-claude-code-${SID}`)).toBe(`conversation:conv-claude-code-${SID}`);
  });
});

describe("estimateConversationIngestTokens", () => {
  it("候補の本数に 1 本あたりの幅を掛ける", () => {
    expect(estimateConversationIngestTokens(4)).toEqual({ low: 280_000, high: 360_000 });
  });

  it("0 本なら 0〜0", () => {
    expect(estimateConversationIngestTokens(0)).toEqual({ low: 0, high: 0 });
  });
});
