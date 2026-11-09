// Embedding Store のテスト。IndexedDB は fake-indexeddb（node 環境、DOM 不要）。
//
// 対象の不変条件:
// - searchByVector は今のモデル版（modelVersion）と一致しないレコードを比較対象から外す
//   （次元は同じだが意味空間が違うモデルに切り替えたとき、もっともらしいが無意味な
//   類似度を返さないため）
// - isEmbeddingIndexStale は「索引に今の版のレコードが 1 件も無い」ときだけ true を返す
//   （同じ版が混ざっていれば false・索引が空でも false = 判定不能として案内しない）

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { embeddingStore } from "./embedding-store";

beforeEach(() => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  // isEmbeddingIndexStale が IDBKeyRange.only を使う（node 環境には無いのでスタブする）
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchByVector", () => {
  it("excludes records whose modelVersion differs from the query's model version", async () => {
    // 同じ次元・同じベクトルでも modelVersion が違えば比較対象に入らない
    await embeddingStore.setEmbedding("wiki-a", "sec-1", [1, 0, 0], "model-v1", "current model text");
    await embeddingStore.setEmbedding("wiki-b", "sec-1", [1, 0, 0], "model-v0-old", "old model text");

    const results = await embeddingStore.searchByVector([1, 0, 0], 10, "model-v1");

    expect(results.map((r) => r.documentId)).toEqual(["wiki-a"]);
  });

  it("returns nothing when no record matches the given model version", async () => {
    await embeddingStore.setEmbedding("wiki-a", "sec-1", [1, 0, 0], "model-v0-old", "old model text");

    const results = await embeddingStore.searchByVector([1, 0, 0], 10, "model-v1");

    expect(results).toEqual([]);
  });
});

describe("isEmbeddingIndexStale", () => {
  it("returns false when the index only has records for the current model version", async () => {
    await embeddingStore.setEmbedding("wiki-a", "sec-1", [1, 0, 0], "model-v1", "text a");
    await embeddingStore.setEmbedding("wiki-b", "sec-1", [0, 1, 0], "model-v1", "text b");

    expect(await embeddingStore.isEmbeddingIndexStale("model-v1")).toBe(false);
  });

  it("returns true when the index only has records for a different model version", async () => {
    await embeddingStore.setEmbedding("wiki-a", "sec-1", [1, 0, 0], "model-v0-old", "text a");

    expect(await embeddingStore.isEmbeddingIndexStale("model-v1")).toBe(true);
  });

  it("returns false when the index is empty (nothing embedded yet)", async () => {
    expect(await embeddingStore.isEmbeddingIndexStale("model-v1")).toBe(false);
  });
});

describe("connection reuse", () => {
  // 作り直しは約 5,000 節を 1 件ずつ書く。呼び出しのたびに open して閉じないと、
  // 接続が GC 待ちで数千積み上がる（Web 版でタブが落ちた原因の 1 つ）
  it("opens the database once for many writes and reads", async () => {
    const factory = globalThis.indexedDB as IDBFactory;
    const openSpy = vi.spyOn(factory, "open");

    for (let i = 0; i < 20; i++) {
      await embeddingStore.setEmbedding(`wiki-${i}`, "sec-1", [1, 0, 0], "model-v1", `text ${i}`);
    }
    await embeddingStore.deleteByDocument("wiki-0");
    const ids = await embeddingStore.listDocumentIds();

    expect(ids.size).toBe(19);
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it("closes its connection when another connection upgrades the database, then reopens", async () => {
    await embeddingStore.setEmbedding("wiki-a", "sec-1", [1, 0, 0], "model-v1", "text a");
    // 別のタブが版を上げる想定。こちらが閉じないと upgrade が blocked のまま進まない
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("graphium-embeddings", 99);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    upgraded.close();
    // 次の呼び出しは開き直す（版 3 では開けないので失敗するが、閉じた接続を使い回さない）
    await expect(embeddingStore.listDocumentIds()).rejects.toBeTruthy();
  });
});
