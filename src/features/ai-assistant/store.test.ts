// store の純粋ヘルパーのテスト
// buildCurrentChat は「ScopeChat の再構築でフィールドが脱落しない」不変条件を守る
// 要所（フォーク・編集&再実行の土台）なので、通線をここで固定する。

import { describe, expect, it } from "vitest";
import { buildCurrentChat, upsertChat, type AiAssistantState } from "./store";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function baseState(overrides: Partial<AiAssistantState> = {}): AiAssistantState {
  return {
    sourceBlockIds: [],
    quotedMarkdown: "",
    loading: false,
    error: null,
    messages: [msg("user", "Q1"), msg("assistant", "A1")],
    activeChatId: "chat-1",
    chats: [],
    sessionId: null,
    forkedFrom: null,
    chatRequestSeq: 0,
    ...overrides,
  };
}

describe("buildCurrentChat", () => {
  it("messages が空なら null を返す", () => {
    expect(buildCurrentChat(baseState({ messages: [] }))).toBeNull();
  });

  it("activeChatId を安定 ID として使う（増殖防止）", () => {
    const chat = buildCurrentChat(baseState());
    expect(chat?.id).toBe("chat-1");
  });

  it("chats に既存エントリがあればその ID・createdAt を維持する", () => {
    const existing: ScopeChat = {
      id: "chat-1",
      scopeBlockId: "",
      scopeType: "page",
      messages: [msg("user", "Q1")],
      createdAt: "2025-12-31T00:00:00.000Z",
      modifiedAt: "2025-12-31T00:00:00.000Z",
    };
    const chat = buildCurrentChat(baseState({ chats: [existing] }));
    expect(chat?.id).toBe("chat-1");
    expect(chat?.createdAt).toBe("2025-12-31T00:00:00.000Z");
  });

  it("state の forkedFrom を ScopeChat に通線する", () => {
    const forkedFrom = { chatId: "parent-1", messageIndex: 3 };
    const chat = buildCurrentChat(baseState({ forkedFrom }));
    expect(chat?.forkedFrom).toEqual(forkedFrom);
  });

  it("state に forkedFrom が無くても既存エントリの forkedFrom を維持する（脱落防止）", () => {
    const existing: ScopeChat = {
      id: "chat-1",
      scopeBlockId: "",
      scopeType: "page",
      messages: [msg("user", "Q1")],
      forkedFrom: { chatId: "parent-1", messageIndex: 1 },
      createdAt: "2025-12-31T00:00:00.000Z",
      modifiedAt: "2025-12-31T00:00:00.000Z",
    };
    const chat = buildCurrentChat(baseState({ chats: [existing] }));
    expect(chat?.forkedFrom).toEqual({ chatId: "parent-1", messageIndex: 1 });
  });

  it("フォークしていないチャットには forkedFrom キー自体を付けない（永続 JSON を汚さない）", () => {
    const chat = buildCurrentChat(baseState());
    expect(chat && "forkedFrom" in chat).toBe(false);
  });
});

describe("upsertChat", () => {
  const chatA: ScopeChat = {
    id: "a",
    scopeBlockId: "",
    scopeType: "page",
    messages: [msg("user", "Q")],
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };

  it("null はそのまま返す", () => {
    const chats = [chatA];
    expect(upsertChat(chats, null)).toBe(chats);
  });

  it("同 ID があれば置換する", () => {
    const updated = { ...chatA, modifiedAt: "2026-01-02T00:00:00.000Z" };
    const result = upsertChat([chatA], updated);
    expect(result).toHaveLength(1);
    expect(result[0].modifiedAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("無ければ末尾に追加する", () => {
    const chatB = { ...chatA, id: "b" };
    const result = upsertChat([chatA], chatB);
    expect(result.map((c) => c.id)).toEqual(["a", "b"]);
  });
});
