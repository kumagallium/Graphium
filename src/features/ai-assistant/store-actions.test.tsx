// @vitest-environment jsdom
// AiAssistantProvider の run 連携アクションの不変条件テスト
//
// 対象の不変条件（チャット実行のアプリレベル管理 = chat-run-manager 連携）:
// - addMessage/rewriteFrom の chatId 引数は「activeChatId 未発行のときだけ」効く
//   （run 側と書き戻し先 id を一致させつつ、既存チャットの id を上書きしない）
// - applyChatRunResult は activeChatId 一致時のみ表示中の会話を確定形に置き換え、
//   不一致なら chats への upsert に留める（応答が切替先チャットへ混入しない）
// - resumeRunningChat は run のスナップショットからアクティブ会話を復元する

import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { AiAssistantProvider, useAiAssistant } from "./store";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function chat(id: string, contents: string[], overrides: Partial<ScopeChat> = {}): ScopeChat {
  return {
    id,
    scopeBlockId: "",
    scopeType: "page",
    messages: contents.map((c, i) => msg(i % 2 === 0 ? "user" : "assistant", c)),
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setup() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AiAssistantProvider>{children}</AiAssistantProvider>
  );
  return renderHook(() => useAiAssistant(), { wrapper });
}

describe("addMessage / rewriteFrom の chatId 引数", () => {
  it("activeChatId 未発行なら chatId を採用する", () => {
    const { result } = setup();
    act(() => result.current.addMessage(msg("user", "Q1"), "chat-fixed"));
    expect(result.current.activeChatId).toBe("chat-fixed");
  });

  it("activeChatId 既発行なら chatId は無視される", () => {
    const { result } = setup();
    act(() => result.current.addMessage(msg("user", "Q1"), "chat-first"));
    act(() => result.current.addMessage(msg("user", "Q2"), "chat-other"));
    expect(result.current.activeChatId).toBe("chat-first");
  });

  it("rewriteFrom も未発行時のみ chatId を採用する", () => {
    const { result } = setup();
    act(() => result.current.rewriteFrom(0, msg("user", "Q1-edited"), "chat-rewind"));
    expect(result.current.activeChatId).toBe("chat-rewind");
    expect(result.current.messages.map((m) => m.content)).toEqual(["Q1-edited"]);
  });
});

describe("applyChatRunResult", () => {
  it("activeChatId 一致: 表示中の会話を確定形に置き換え loading を解除する", () => {
    const { result } = setup();
    act(() => {
      result.current.addMessage(msg("user", "Q1"), "chat-1");
      result.current.setLoading(true);
    });
    const settled = chat("chat-1", ["Q1", "A1"]);
    act(() => result.current.applyChatRunResult(settled, "session-9"));
    expect(result.current.messages.map((m) => m.content)).toEqual(["Q1", "A1"]);
    expect(result.current.sessionId).toBe("session-9");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    // chats にも同 id で upsert される（増殖しない）
    expect(result.current.chats.filter((c) => c.id === "chat-1")).toHaveLength(1);
  });

  it("activeChatId 不一致: chats のみ更新し、表示中の会話に混入しない", () => {
    const { result } = setup();
    // 応答待ち中に別チャットへ切り替えたシナリオ: active は chat-2
    act(() => {
      result.current.restoreChats([chat("chat-2", ["X1", "Y1"])]);
      result.current.selectChat("chat-2");
      result.current.setLoading(true);
    });
    const settled = chat("chat-1", ["Q1", "A1"]);
    act(() => result.current.applyChatRunResult(settled, "session-9"));
    expect(result.current.messages.map((m) => m.content)).toEqual(["X1", "Y1"]);
    expect(result.current.chats.find((c) => c.id === "chat-1")?.messages).toHaveLength(2);
    expect(result.current.loading).toBe(false);
  });

  it("冪等: 同じ結果を二重適用しても増殖・変化しない", () => {
    const { result } = setup();
    act(() => {
      result.current.addMessage(msg("user", "Q1"), "chat-1");
      result.current.setLoading(true);
    });
    const settled = chat("chat-1", ["Q1", "A1"]);
    act(() => result.current.applyChatRunResult(settled, "session-9"));
    act(() => result.current.applyChatRunResult(settled, "session-9"));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.chats.filter((c) => c.id === "chat-1")).toHaveLength(1);
  });
});

describe("applyChatRunError", () => {
  it("activeChatId 一致: エラーを表示して loading を解除する", () => {
    const { result } = setup();
    act(() => {
      result.current.addMessage(msg("user", "Q1"), "chat-1");
      result.current.setLoading(true);
    });
    act(() => result.current.applyChatRunError("chat-1", "接続に失敗しました"));
    expect(result.current.error).toBe("接続に失敗しました");
    expect(result.current.loading).toBe(false);
  });

  it("activeChatId 不一致: loading だけ解除しエラーは出さない", () => {
    const { result } = setup();
    act(() => {
      result.current.restoreChats([chat("chat-2", ["X1"])]);
      result.current.selectChat("chat-2");
      result.current.setLoading(true);
    });
    act(() => result.current.applyChatRunError("chat-1", "接続に失敗しました"));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

describe("resumeRunningChat", () => {
  it("実行中 run の会話をアクティブ展開し loading を復元する", () => {
    const { result } = setup();
    const running = chat("chat-1", ["Q1"]);
    act(() =>
      result.current.resumeRunningChat(running, {
        sourceBlockIds: ["block-1"],
        quotedMarkdown: "> 引用",
        sessionId: "session-1",
        forkedFrom: null,
        running: true,
      }),
    );
    expect(result.current.activeChatId).toBe("chat-1");
    expect(result.current.messages.map((m) => m.content)).toEqual(["Q1"]);
    expect(result.current.loading).toBe(true);
    expect(result.current.sourceBlockIds).toEqual(["block-1"]);
    expect(result.current.quotedMarkdown).toBe("> 引用");
    expect(result.current.sessionId).toBe("session-1");
    expect(result.current.chats.find((c) => c.id === "chat-1")).toBeTruthy();
  });

  it("エラー付き復元: loading なし + エラー文言を表示する", () => {
    const { result } = setup();
    act(() =>
      result.current.resumeRunningChat(chat("chat-1", ["Q1"]), {
        sourceBlockIds: [],
        quotedMarkdown: "",
        sessionId: null,
        forkedFrom: null,
        running: false,
        error: "AI が応答しませんでした",
      }),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("AI が応答しませんでした");
  });

  it("別チャット表示中なら先に退避してから展開する（上書きで消さない）", () => {
    const { result } = setup();
    act(() => {
      result.current.addMessage(msg("user", "X1"), "chat-2");
    });
    act(() =>
      result.current.resumeRunningChat(chat("chat-1", ["Q1"]), {
        sourceBlockIds: [],
        quotedMarkdown: "",
        sessionId: null,
        forkedFrom: null,
        running: true,
      }),
    );
    expect(result.current.activeChatId).toBe("chat-1");
    // 表示中だった chat-2 は chats に退避されている
    expect(result.current.chats.find((c) => c.id === "chat-2")?.messages).toHaveLength(1);
  });
});
