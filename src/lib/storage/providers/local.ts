// ローカルストレージプロバイダー（IndexedDB ベース）
// Google アカウント不要でオフライン利用可能

import type { StorageProvider, AuthState, MediaUploadResult } from "../types";
import type { GraphiumDocument, GraphiumFile } from "../../document-types";
import { migrateToLatest } from "../../document-migration";

const DB_NAME = "graphium-local";
const DB_VERSION = 1;

// IndexedDB ストア名
const STORE_FILES = "files";        // ノートファイル
const STORE_MEDIA = "media";        // メディアファイル（Blob）

/** IndexedDB から DB を取得 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_MEDIA)) {
        db.createObjectStore(STORE_MEDIA, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB トランザクションヘルパー */
async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 全件取得ヘルパー */
async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** UUID 生成 */
function generateId(): string {
  return crypto.randomUUID();
}

// 認証状態リスナー
let authListeners: Array<(state: AuthState) => void> = [];
let signedIn = false;
// Blob URL キャッシュ（local-media:// → blob: の変換結果を再利用）
const mediaBlobCache = new Map<string, string>();

export class LocalStorageProvider implements StorageProvider {
  readonly id = "local";
  readonly displayName = "Local (Offline)";

  async init(): Promise<void> {
    // IndexedDB が使えるか確認
    await openDB();
    // ローカルは即座にサインイン状態
    signedIn = true;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  signIn(): void {
    signedIn = true;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  signOut(): void {
    signedIn = false;
    authListeners.forEach((fn) => fn(this.getAuthState()));
  }

  getAuthState(): AuthState {
    return { isSignedIn: signedIn, userEmail: null };
  }

  onAuthChange(fn: (state: AuthState) => void): () => void {
    authListeners.push(fn);
    return () => {
      authListeners = authListeners.filter((l) => l !== fn);
    };
  }

  async listFiles(): Promise<GraphiumFile[]> {
    const records = await getAll<{ id: string; name: string; content: GraphiumDocument; modifiedTime: string; createdTime: string }>(STORE_FILES);
    return records
      // アプリ内部データ（インデックス等）と Wiki ドキュメントを除外
      .filter((r) => !r.id.startsWith("__app__") && !r.id.startsWith("__wiki__"))
      .map((r) => ({
        id: r.id,
        name: r.name,
        modifiedTime: r.modifiedTime,
        createdTime: r.createdTime,
      }))
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
  }

  async loadFile(fileId: string): Promise<GraphiumDocument> {
    const record = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(fileId)
    );
    if (!record) throw new Error(`ファイルが見つかりません: ${fileId}`);
    return migrateToLatest(record.content);
  }

  async createFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();
    const name = `${title}.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({ id, name, content, modifiedTime: now, createdTime: now })
    );
    return id;
  }

  async saveFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const existing = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(fileId)
    );
    const now = new Date().toISOString();
    const name = `${content.title}.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({
        id: fileId,
        name,
        content,
        modifiedTime: now,
        createdTime: existing?.createdTime ?? now,
      })
    );
  }

  async deleteFile(fileId: string): Promise<void> {
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.delete(fileId)
    );
  }

  async uploadMedia(file: File): Promise<MediaUploadResult> {
    const id = generateId();
    const blob = new Blob([await file.arrayBuffer()], { type: file.type });

    // IndexedDB にメタデータと Blob を保存
    await withStore(STORE_MEDIA, "readwrite", (store) =>
      store.put({ id, name: file.name, mimeType: file.type, blob, createdTime: new Date().toISOString() })
    );

    // 永続的な URL 形式（セッションをまたいで有効）
    const url = `local-media://${id}`;
    return { fileId: id, url, name: file.name, mimeType: file.type };
  }

  async getMediaBlobUrl(fileId: string): Promise<string> {
    // Blob URL キャッシュ（同一セッション内で再利用）
    const cached = mediaBlobCache.get(fileId);
    if (cached) return cached;

    const record = await withStore<any>(STORE_MEDIA, "readonly", (store) =>
      store.get(fileId)
    );
    if (!record?.blob) throw new Error(`メディアが見つかりません: ${fileId}`);
    const blobUrl = URL.createObjectURL(record.blob);
    mediaBlobCache.set(fileId, blobUrl);
    return blobUrl;
  }

  extractFileId(url: string): string | null {
    // local-media://{fileId} 形式から ID を抽出
    const match = url.match(/^local-media:\/\/(.+)$/);
    return match ? match[1] : null;
  }

  async getUserEmail(): Promise<string | null> {
    return null;
  }

  // ローカルはリビジョン管理なし
  // getRevisionId は定義しない（オプショナル）

  async authedFetch(_url: string, _options?: RequestInit): Promise<Response> {
    throw new Error("ローカルストレージでは authedFetch は使用できません");
  }

  // --- アプリデータ（インデックスファイル等を IndexedDB に保存） ---

  async readAppData(key: string): Promise<unknown | null> {
    try {
      const record = await withStore<any>(STORE_FILES, "readonly", (store) =>
        store.get(`__app__${key}`)
      );
      return record?.content ?? null;
    } catch {
      return null;
    }
  }

  async writeAppData(key: string, data: unknown): Promise<void> {
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({ id: `__app__${key}`, name: key, content: data, modifiedTime: new Date().toISOString(), createdTime: new Date().toISOString() })
    );
  }

  // --- メディア管理 ---

  async renameMedia(fileId: string, newName: string): Promise<void> {
    const record = await withStore<any>(STORE_MEDIA, "readonly", (store) =>
      store.get(fileId)
    );
    if (record) {
      record.name = newName;
      await withStore(STORE_MEDIA, "readwrite", (store) => store.put(record));
    }
  }

  async deleteMedia(fileId: string): Promise<void> {
    await withStore(STORE_MEDIA, "readwrite", (store) =>
      store.delete(fileId)
    );
  }

  async listMediaFiles(): Promise<{ id: string; name: string; mimeType: string; createdTime: string }[]> {
    const records = await getAll<{ id: string; name: string; mimeType: string; createdTime: string }>(STORE_MEDIA);
    return records;
  }

  clearCache(): void {
    // ローカルにキャッシュ管理は不要
  }

  // --- Wiki ドキュメント CRUD ---

  async listWikiFiles(): Promise<GraphiumFile[]> {
    const records = await getAll<{ id: string; name: string; modifiedTime: string; createdTime: string }>(STORE_FILES);
    const wikiRecords = records.filter((r) => r.id.startsWith("__wiki__"));
    console.log(`[wiki-debug] LocalProvider.listWikiFiles: total records=${records.length}, wiki records=${wikiRecords.length}`, wikiRecords.map(r => r.id));
    return wikiRecords
      .map((r) => ({
        id: r.id.replace("__wiki__", ""),
        name: r.name,
        modifiedTime: r.modifiedTime,
        createdTime: r.createdTime,
      }))
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
  }

  async loadWikiFile(fileId: string): Promise<GraphiumDocument> {
    const record = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(`__wiki__${fileId}`)
    );
    if (!record) throw new Error(`Wiki が見つかりません: ${fileId}`);
    return record.content;
  }

  async createWikiFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();
    const name = `${title}.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({ id: `__wiki__${id}`, name, content, modifiedTime: now, createdTime: now })
    );
    return id;
  }

  async saveWikiFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const key = `__wiki__${fileId}`;
    const existing = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(key)
    );
    const now = new Date().toISOString();
    const name = `${content.title}.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({
        id: key,
        name,
        content,
        modifiedTime: now,
        createdTime: existing?.createdTime ?? now,
      })
    );
  }

  async deleteWikiFile(fileId: string): Promise<void> {
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.delete(`__wiki__${fileId}`)
    );
  }

  // --- Skill ドキュメント CRUD ---

  async listSkillFiles(): Promise<GraphiumFile[]> {
    const records = await getAll<{ id: string; name: string; modifiedTime: string; createdTime: string }>(STORE_FILES);
    const skillRecords = records.filter((r) => r.id.startsWith("__skill__"));
    return skillRecords
      .map((r) => ({
        id: r.id.replace("__skill__", ""),
        name: r.name,
        modifiedTime: r.modifiedTime,
        createdTime: r.createdTime,
      }))
      .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime());
  }

  async loadSkillFile(fileId: string): Promise<GraphiumDocument> {
    const record = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(`__skill__${fileId}`)
    );
    if (!record) throw new Error(`Skill が見つかりません: ${fileId}`);
    return record.content;
  }

  async createSkillFile(title: string, content: GraphiumDocument): Promise<string> {
    const id = generateId();
    const now = new Date().toISOString();
    const name = `${title}.skill.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({ id: `__skill__${id}`, name, content, modifiedTime: now, createdTime: now })
    );
    return id;
  }

  async saveSkillFile(fileId: string, content: GraphiumDocument): Promise<void> {
    const key = `__skill__${fileId}`;
    const existing = await withStore<any>(STORE_FILES, "readonly", (store) =>
      store.get(key)
    );
    const now = new Date().toISOString();
    const name = `${content.title}.skill.graphium.json`;
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.put({
        id: key,
        name,
        content,
        modifiedTime: now,
        createdTime: existing?.createdTime ?? now,
      })
    );
  }

  async deleteSkillFile(fileId: string): Promise<void> {
    await withStore(STORE_FILES, "readwrite", (store) =>
      store.delete(`__skill__${fileId}`)
    );
  }
}
