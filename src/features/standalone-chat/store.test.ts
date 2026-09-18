import { describe, it, expect } from "vitest";
import type { StorageProvider } from "../../lib/storage/types";
import type { StandaloneChat } from "./types";
import {
  loadStandaloneChatIndex,
  loadStandaloneChat,
  saveStandaloneChat,
  deleteStandaloneChat,
  createStandaloneChat,
} from "./store";

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(): StorageProvider {
  const store = new Map<string, unknown>();
  return {
    readAppData: async (k: string) => (store.has(k) ? store.get(k) : null),
    writeAppData: async (k: string, v: unknown) => {
      if (v === null) {
        store.delete(k);
      } else {
        store.set(k, v);
      }
    },
    __store: store,
  } as unknown as StorageProvider;
}

function makeChat(overrides?: Partial<StandaloneChat>): StandaloneChat {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    messages: [
      { role: "user", content: "最初の質問", timestamp: now },
      { role: "assistant", content: "回答", timestamp: now },
    ],
    createdAt: now,
    modifiedAt: now,
    ...overrides,
  };
}

describe("standalone-chat/store", () => {
  it("索引が空のとき空配列", async () => {
    const provider = makeProvider();
    expect(await loadStandaloneChatIndex(provider)).toEqual([]);
  });

  it("保存すると索引に 1 行増え、firstQuestion と messageCount が本文から導出される", async () => {
    const provider = makeProvider();
    const chat = makeChat();
    await saveStandaloneChat(provider, chat);

    const index = await loadStandaloneChatIndex(provider);
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe(chat.id);
    expect(index[0].firstQuestion).toBe("最初の質問");
    expect(index[0].messageCount).toBe(2);

    const loaded = await loadStandaloneChat(provider, chat.id);
    expect(loaded?.messages).toHaveLength(2);
  });

  it("同じ id で 2 回保存しても索引が重複しない", async () => {
    const provider = makeProvider();
    const chat = makeChat();
    await saveStandaloneChat(provider, chat);
    const updated: StandaloneChat = {
      ...chat,
      messages: [...chat.messages, { role: "user", content: "追加の質問", timestamp: new Date().toISOString() }],
      modifiedAt: new Date().toISOString(),
    };
    await saveStandaloneChat(provider, updated);

    const index = await loadStandaloneChatIndex(provider);
    expect(index).toHaveLength(1);
    expect(index[0].messageCount).toBe(3);
  });

  it("削除で索引から消え、本体が null になる", async () => {
    const provider = makeProvider();
    const chat = makeChat();
    await saveStandaloneChat(provider, chat);
    await deleteStandaloneChat(provider, chat.id);

    expect(await loadStandaloneChatIndex(provider)).toEqual([]);
    expect(await loadStandaloneChat(provider, chat.id)).toBeNull();
  });

  it("壊れた JSON（配列でない・オブジェクトでない）でも落ちずに空として扱う", async () => {
    const provider: StorageProvider = {
      readAppData: async () => "壊れたデータ",
      writeAppData: async () => {},
    } as unknown as StorageProvider;
    expect(await loadStandaloneChatIndex(provider)).toEqual([]);

    const providerArray: StorageProvider = {
      readAppData: async () => [1, 2, 3],
      writeAppData: async () => {},
    } as unknown as StorageProvider;
    expect(await loadStandaloneChatIndex(providerArray)).toEqual([]);
  });

  it("長い質問文は索引の firstQuestion で切り詰められる（本文は切り詰めない）", async () => {
    const provider = makeProvider();
    const longQuestion = "あ".repeat(300);
    const chat = makeChat({
      messages: [{ role: "user", content: longQuestion, timestamp: new Date().toISOString() }],
    });
    await saveStandaloneChat(provider, chat);

    const index = await loadStandaloneChatIndex(provider);
    expect(index[0].firstQuestion.length).toBeLessThan(longQuestion.length);
    expect(index[0].firstQuestion.length).toBeLessThanOrEqual(120);

    const loaded = await loadStandaloneChat(provider, chat.id);
    expect(loaded?.messages[0].content).toBe(longQuestion);
  });

  it("createStandaloneChat は保存せず空の会話を返す", async () => {
    const provider = makeProvider();
    const chat = createStandaloneChat(["note-1"]);
    expect(chat.messages).toEqual([]);
    expect(chat.attachedNoteIds).toEqual(["note-1"]);
    expect(await loadStandaloneChatIndex(provider)).toEqual([]);
  });
});
