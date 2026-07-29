import { describe, it, expect } from "vitest";
import type { ScopeChat } from "../../lib/document-types";
import type { StorageProvider } from "../../lib/storage/types";
import { loadAssetChats, saveAssetChats } from "./asset-chat-store";

/** readAppData / writeAppData だけを in-memory で実装した最小プロバイダ */
function makeProvider(): StorageProvider & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    readAppData: async (k: string) => (store.has(k) ? store.get(k) : null),
    writeAppData: async (k: string, v: unknown) => {
      store.set(k, v);
    },
  } as unknown as StorageProvider & { store: Map<string, unknown> };
}

function makeChat(id: string, text: string): ScopeChat {
  return {
    id,
    scopeBlockId: "",
    scopeType: "page",
    messages: [
      { role: "user", content: text, timestamp: "2026-07-29T03:04:00.000Z" },
      { role: "assistant", content: `${text} への回答`, timestamp: "2026-07-29T03:04:30.000Z" },
    ],
    createdAt: "2026-07-29T03:04:00.000Z",
    modifiedAt: "2026-07-29T03:04:30.000Z",
  };
}

describe("asset-chat-store", () => {
  it("保存した履歴を同じ素材で読み戻せる", async () => {
    const provider = makeProvider();
    const chats = [makeChat("c1", "この論文の主張は？")];
    await saveAssetChats(provider, "pdf-abc", chats);
    expect(await loadAssetChats(provider, "pdf-abc")).toEqual(chats);
  });

  it("素材ごとに独立している（別素材の履歴が混ざらない）", async () => {
    const provider = makeProvider();
    await saveAssetChats(provider, "pdf-abc", [makeChat("c1", "A の質問")]);
    await saveAssetChats(provider, "pdf-xyz", [makeChat("c2", "B の質問")]);
    const a = await loadAssetChats(provider, "pdf-abc");
    const b = await loadAssetChats(provider, "pdf-xyz");
    expect(a.map((c) => c.id)).toEqual(["c1"]);
    expect(b.map((c) => c.id)).toEqual(["c2"]);
  });

  it("未保存の素材は空配列（履歴なし扱い）", async () => {
    const provider = makeProvider();
    expect(await loadAssetChats(provider, "pdf-none")).toEqual([]);
  });

  it("空配列の保存は null 上書き（論理削除）で、読むと空配列に戻る", async () => {
    const provider = makeProvider();
    await saveAssetChats(provider, "pdf-abc", [makeChat("c1", "質問")]);
    await saveAssetChats(provider, "pdf-abc", []);
    expect(provider.store.get("asset-chats:pdf-abc")).toBeNull();
    expect(await loadAssetChats(provider, "pdf-abc")).toEqual([]);
  });

  it("appData 非対応プロバイダでも落ちない（保存は黙って no-op）", async () => {
    const bare = {} as StorageProvider;
    await expect(saveAssetChats(bare, "pdf-abc", [makeChat("c1", "質問")])).resolves.toBeUndefined();
    expect(await loadAssetChats(bare, "pdf-abc")).toEqual([]);
  });

  it("配列でない内容が入っていても空配列として読む", async () => {
    const provider = makeProvider();
    provider.store.set("asset-chats:pdf-broken", { unexpected: true });
    expect(await loadAssetChats(provider, "pdf-broken")).toEqual([]);
  });
});
