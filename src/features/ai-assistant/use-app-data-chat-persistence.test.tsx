// @vitest-environment jsdom
// useAppDataChatPersistence（appData へのチャット履歴の出し入れ）の不変条件テスト。
//
// 対象の不変条件:
// - 読込が終わるまでは書き出さない（空の初期状態で既存履歴を潰さない）
// - 保存は 600ms の debounce（連打しても最後の 1 回だけ書く）
// - unmount で debounce 待ちを書き切る（閉じる瞬間の取りこぼし防止）
// - key が変わっても前の key へは書かない（Provider の作り直しが外れたときの保険）
// - 保存済み履歴はマウント時に restoreChats で流し込まれる

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { AiAssistantProvider, useAiAssistant } from "./store";
import { useAppDataChatPersistence } from "./use-app-data-chat-persistence";
import type { ChatMessage, ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(opts: { readDelay?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const writes: Array<{ key: string; value: unknown }> = [];
  /** readDelay 指定時、読込を手動で解決するための保留リスト */
  const pendingReads: Array<() => void> = [];
  const provider = {
    readAppData: (k: string) =>
      new Promise<unknown>((resolve) => {
        const settle = () => resolve(store.has(k) ? store.get(k) : null);
        if (opts.readDelay) pendingReads.push(settle);
        else settle();
      }),
    writeAppData: async (k: string, v: unknown) => {
      writes.push({ key: k, value: v });
      store.set(k, v);
    },
  } as unknown as StorageProvider;
  return {
    provider,
    store,
    writes,
    /** 保留中の読込をすべて解決する */
    releaseReads: () => {
      const queued = pendingReads.splice(0);
      for (const settle of queued) settle();
    },
  };
}

function msg(role: ChatMessage["role"], content: string): ChatMessage {
  return { role, content, timestamp: "2026-01-01T00:00:00.000Z" };
}

function chat(id: string, contents: string[]): ScopeChat {
  return {
    id,
    scopeBlockId: "",
    scopeType: "page",
    messages: contents.map((c, i) => msg(i % 2 === 0 ? "user" : "assistant", c)),
    createdAt: "2026-01-01T00:00:00.000Z",
    modifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** フックと、テストから会話を動かすためのストアを一緒に返す */
function setup(provider: StorageProvider, initialKey: string) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AiAssistantProvider>{children}</AiAssistantProvider>
  );
  return renderHook(
    ({ chatKey }: { chatKey: string }) => {
      useAppDataChatPersistence({ provider, key: chatKey });
      return useAiAssistant();
    },
    { wrapper, initialProps: { chatKey: initialKey } },
  );
}

/** debounce と、その中で走る保存 Promise を消化する */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useAppDataChatPersistence", () => {
  it("読込が終わるまでは書き出さない", async () => {
    const p = makeProvider({ readDelay: true });
    const { result } = setup(p.provider, "scope-chats:a");

    // 読込を保留したまま会話を進める
    act(() => result.current.addMessage(msg("user", "Q1")));
    await advance(2000);
    expect(p.writes).toEqual([]);

    // 読込が終われば以降は保存される
    await act(async () => {
      p.releaseReads();
    });
    act(() => result.current.addMessage(msg("assistant", "A1")));
    await advance(600);
    expect(p.writes.map((w) => w.key)).toEqual(["scope-chats:a"]);
  });

  it("会話の変化を 600ms debounce して保存する", async () => {
    const p = makeProvider();
    const { result } = setup(p.provider, "scope-chats:a");
    await act(async () => {});

    act(() => result.current.addMessage(msg("user", "Q1")));
    await advance(300);
    expect(p.writes).toEqual([]); // まだ待っている

    act(() => result.current.addMessage(msg("assistant", "A1")));
    await advance(300);
    expect(p.writes).toEqual([]); // 追記でタイマーが引き直される

    await advance(300);
    expect(p.writes).toHaveLength(1);
    const saved = p.writes[0].value as ScopeChat[];
    expect(saved).toHaveLength(1);
    expect(saved[0].messages.map((m) => m.content)).toEqual(["Q1", "A1"]);
  });

  it("unmount で debounce 待ちを書き切る", async () => {
    const p = makeProvider();
    const { result, unmount } = setup(p.provider, "scope-chats:a");
    await act(async () => {});

    act(() => result.current.addMessage(msg("user", "閉じる直前の質問")));
    await advance(100); // debounce 途中
    expect(p.writes).toEqual([]);

    unmount();
    await act(async () => {});
    expect(p.writes).toHaveLength(1);
    const saved = p.writes[0].value as ScopeChat[];
    expect(saved[0].messages.map((m) => m.content)).toEqual(["閉じる直前の質問"]);
  });

  it("key が変わっても前の key には書かない", async () => {
    const p = makeProvider();
    const { result, rerender } = setup(p.provider, "scope-chats:a");
    await act(async () => {});

    act(() => result.current.addMessage(msg("user", "A の質問")));
    await advance(100); // 保存待ちのまま対象が切り替わる
    rerender({ chatKey: "scope-chats:b" });
    await advance(600);

    // 保存待ちは現在の key に向かう（前の対象のファイルは触らない）。
    // 実運用では対象ごとに AiAssistantProvider を作り直すのでこの経路は保険。
    expect(p.writes.map((w) => w.key)).toEqual(["scope-chats:b"]);
    expect(p.store.has("scope-chats:a")).toBe(false);
  });

  it("保存済み履歴はマウント時に復元される", async () => {
    const p = makeProvider();
    p.store.set("scope-chats:a", [chat("c1", ["前回の質問", "前回の回答"])]);
    const { result } = setup(p.provider, "scope-chats:a");
    await act(async () => {});

    expect(result.current.chats.map((c) => c.id)).toEqual(["c1"]);
  });

  it("空の会話しか無ければ書き出さない（空ファイルを作らない）", async () => {
    const p = makeProvider();
    setup(p.provider, "scope-chats:a");
    await act(async () => {});
    await advance(1000);
    expect(p.writes).toEqual([]);
  });
});
