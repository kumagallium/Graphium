// fork-base（fork した時点の基準版の控え）のテスト。
//
// ここで守りたいこと:
//   1. 本文は読んだ文字列のまま往復する（作り直さない = 提案時に同じ blob へ畳める）
//   2. ノートごとに別のキーで持つ（他のノートの控えを踏まない）
//   3. 読めない・書けない・壊れているは失敗にしない（base 無しの 2 者比較に落ちるだけ）

import { describe, it, expect } from "vitest";

import { saveForkBase, loadForkBase } from "./fork-base";
import type { StorageProvider } from "../../lib/storage/types";

/** readAppData / writeAppData だけを持つ最小のプロバイダ（他は使わない） */
function fakeProvider(store = new Map<string, unknown>()) {
  const provider = {
    async readAppData(key: string) {
      return store.has(key) ? store.get(key) : null;
    },
    async writeAppData(key: string, data: unknown) {
      store.set(key, data);
    },
  } as unknown as StorageProvider;
  return { provider, store };
}

const BODY = JSON.stringify({ version: 5, title: "測定手順", pages: [] });

describe("saveForkBase / loadForkBase", () => {
  it("控えた本文をそのまま読み戻す", async () => {
    const { provider } = fakeProvider();
    await saveForkBase("note-1", { sharedId: "s1", hash: "sha256:aaa", body: BODY }, provider);
    const loaded = await loadForkBase("note-1", provider);
    expect(loaded?.body).toBe(BODY);
    expect(loaded?.sharedId).toBe("s1");
    expect(loaded?.hash).toBe("sha256:aaa");
    expect(loaded?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("ノートごとに別のキーで持つ", async () => {
    const { provider, store } = fakeProvider();
    await saveForkBase("note-1", { sharedId: "s1", hash: "h1", body: "a" }, provider);
    await saveForkBase("note-2", { sharedId: "s2", hash: "h2", body: "b" }, provider);
    expect(store.size).toBe(2);
    expect((await loadForkBase("note-1", provider))?.body).toBe("a");
    expect((await loadForkBase("note-2", provider))?.body).toBe("b");
  });

  it("キーに Windows で使えない文字を混ぜない", async () => {
    const { provider, store } = fakeProvider();
    await saveForkBase("note:1/x", { sharedId: "s1", hash: "h1", body: "a" }, provider);
    for (const key of store.keys()) {
      expect(key).not.toMatch(/[:\\/]/);
    }
    // 畳んだ後のキーでも読み戻せる
    expect((await loadForkBase("note:1/x", provider))?.body).toBe("a");
  });

  it("控えが無ければ null", async () => {
    const { provider } = fakeProvider();
    expect(await loadForkBase("missing", provider)).toBeNull();
    expect(await loadForkBase("", provider)).toBeNull();
  });

  it("形が違う控えは捨てる（壊れていても落とさない）", async () => {
    const { provider, store } = fakeProvider();
    await saveForkBase("note-1", { sharedId: "s1", hash: "h1", body: BODY }, provider);
    const key = [...store.keys()][0];
    store.set(key, { sharedId: "s1", hash: "h1" }); // body が無い
    expect(await loadForkBase("note-1", provider)).toBeNull();
  });

  it("書き込みに失敗しても投げない（fork は成立させる）", async () => {
    const provider = {
      async writeAppData() {
        throw new Error("disk full");
      },
    } as unknown as StorageProvider;
    await expect(
      saveForkBase("note-1", { sharedId: "s1", hash: "h1", body: BODY }, provider),
    ).resolves.toBeUndefined();
  });

  it("読み込みに失敗しても null を返す", async () => {
    const provider = {
      async readAppData() {
        throw new Error("unreadable");
      },
    } as unknown as StorageProvider;
    expect(await loadForkBase("note-1", provider)).toBeNull();
  });
});
