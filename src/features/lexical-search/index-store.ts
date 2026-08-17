// 語彙インデックスの永続化（IndexedDB）
//
// 埋め込み（graphium-embeddings）と同じく、これは「再構築可能なキャッシュ」であって
// ノートデータの正本ではない。壊れていたら捨てて作り直す。ノート本体・note-index.json
// には一切書かない（インデックスを太らせない・同期対象にしない）。
//
// DB: graphium-lexical-index / store: snapshots / key: scopeKey
// （scopeKey = どのストレージ（provider + アカウント）の索引か。切り替えても互いを壊さない）

import type { LexicalIndexSnapshot } from "./lexical-index";

const DB_NAME = "graphium-lexical-index";
const DB_VERSION = 1;
const STORE_NAME = "snapshots";

export type StoredSnapshot = {
  /** どのストレージ（provider + ルート）の索引か */
  scopeKey: string;
  snapshot: LexicalIndexSnapshot;
  updatedAt: string;
};

function hasIndexedDB(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "scopeKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("graphium-lexical-index: open blocked"));
  });
}

export const lexicalIndexStore = {
  /** 保存済みスナップショットを読む（無ければ null。IndexedDB が無い環境も null） */
  async load(scopeKey: string): Promise<StoredSnapshot | null> {
    if (!hasIndexedDB()) return null;
    try {
      const db = await openDB();
      return await new Promise<StoredSnapshot | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(scopeKey);
        req.onsuccess = () => resolve((req.result as StoredSnapshot | undefined) ?? null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      });
    } catch {
      return null;
    }
  },

  /** スナップショットを保存（同じ scopeKey は上書き） */
  async save(snapshot: LexicalIndexSnapshot, scopeKey: string): Promise<void> {
    if (!hasIndexedDB()) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: StoredSnapshot = { scopeKey, snapshot, updatedAt: new Date().toISOString() };
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("graphium-lexical-index: save aborted"));
    });
  },

  /** 1 スコープ分を消す（再構築用）。scopeKey 省略で全消去 */
  async clear(scopeKey?: string): Promise<void> {
    if (!hasIndexedDB()) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      if (scopeKey) store.delete(scopeKey);
      else store.clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  },
};
