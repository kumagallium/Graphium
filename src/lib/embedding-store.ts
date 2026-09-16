// Embedding Store（IndexedDB ベース）
// Wiki セクションの embedding ベクトルをローカルに保存・検索する
// ノートデータとは別の IndexedDB データベースを使用

import { cosineSimilarity } from "./vector";

const DB_NAME = "graphium-embeddings";
// v2: 旧バージョンで store が作られていない壊れた DB を救済するためにバンプ。
// onupgradeneeded で "embeddings" store を冪等に作成する。
// v3: modelVersion index を追加（埋め込みモデルを切り替えたときに旧版のベクトルを
// 比較対象から外す / 版ずれ検知を全件走査せず count() で済ませるため）。
const DB_VERSION = 3;
const STORE_NAME = "embeddings";

export type EmbeddingRecord = {
  /** 複合キー: `${documentId}:${sectionId}` */
  id: string;
  documentId: string;
  sectionId: string;
  /** embedding ベクトル */
  vector: number[];
  /** embedding モデルバージョン */
  modelVersion: string;
  /** embedding 対象テキスト（階層コンテキスト付き） */
  text: string;
  updatedAt: string;
};

export type SearchResult = {
  documentId: string;
  sectionId: string;
  score: number;
  text: string;
};

/** IndexedDB を開く */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("documentId", "documentId", { unique: false });
      } else {
        // v2 → v3 移行: store は既にあるので upgrade transaction から同じ store を取る
        store = req.transaction!.objectStore(STORE_NAME);
      }
      if (!store.indexNames.contains("modelVersion")) {
        store.createIndex("modelVersion", "modelVersion", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** トランザクションヘルパー */
async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 全件取得ヘルパー */
async function getAll(): Promise<EmbeddingRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const embeddingStore = {
  /** embedding を保存（upsert） */
  async setEmbedding(
    documentId: string,
    sectionId: string,
    vector: number[],
    modelVersion: string,
    text: string,
  ): Promise<void> {
    const id = `${documentId}:${sectionId}`;
    const record: EmbeddingRecord = {
      id,
      documentId,
      sectionId,
      vector,
      modelVersion,
      text,
      updatedAt: new Date().toISOString(),
    };
    await withStore("readwrite", (store) => store.put(record));
  },

  /**
   * 全 embedding レコードを取得する。
   *
   * ベクトルを持たない text-only レコード（embedding API 非対応時のフォールバック保存）も
   * 含む。retriever のテキストマッチ用。DB を開くのは必ずこのモジュールの openDB() を
   * 通す — 呼び出し側が DB 名・バージョンを別に持つと、DB_VERSION を上げたときに
   * 旧バージョンで開こうとして VersionError になり、静かに何も返せなくなる。
   */
  async getAllRecords(): Promise<EmbeddingRecord[]> {
    return getAll();
  },

  /**
   * ベクトル検索（brute-force コサイン類似度）。
   *
   * `modelVersion` と一致しないレコードは比較対象から外す。埋め込みモデルを切り替えると
   * 次元が変わって cosineSimilarity が 0 を返すケースはまだ安全だが、次元だけ同じで
   * 意味空間が違うモデルに切り替えた場合はすり抜けて「もっともらしいが無意味な類似度」を
   * 返してしまう（トピック・洞察の重複判定と横断検索が静かに壊れる）。呼び出し側は
   * 現在のモデル版（embed API レスポンスの modelVersion）を渡すこと。
   */
  async searchByVector(queryVector: number[], topK: number, modelVersion: string): Promise<SearchResult[]> {
    const records = await getAll();
    const scored = records
      .filter((r) => r.modelVersion === modelVersion)
      .map((r) => ({
        documentId: r.documentId,
        sectionId: r.sectionId,
        score: cosineSimilarity(queryVector, r.vector),
        text: r.text,
      }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  },

  /**
   * 埋め込み索引が今のモデル版で作られているかを軽く判定する。
   *
   * 全件のベクトルは読み込まず、modelVersion index の件数（count()）だけを見る
   * （起動のたびに重い走査をしないため）。索引が空（まだ 1 件も embed していない）の
   * ときは「版が古い」の対象外として false を返す — 何も作っていないだけなので
   * 作り直しを促す必要がない。
   */
  async isEmbeddingIndexStale(currentModelVersion: string): Promise<boolean> {
    if (!currentModelVersion) return false;
    const db = await openDB();
    const total = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (total === 0) return false;
    const currentCount = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("modelVersion");
      const req = index.count(IDBKeyRange.only(currentModelVersion));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return currentCount === 0;
  },

  /** 特定ドキュメントの全 embedding を削除 */
  async deleteByDocument(documentId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("documentId");
      const req = index.openCursor(IDBKeyRange.only(documentId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** 特定ドキュメントの全 embedding を取得 */
  async getAllByDocument(documentId: string): Promise<EmbeddingRecord[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("documentId");
      const req = index.getAll(IDBKeyRange.only(documentId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  /** 全 embedding を削除（再構築用） */
  async clear(): Promise<void> {
    await withStore("readwrite", (store) => store.clear());
  },
};
