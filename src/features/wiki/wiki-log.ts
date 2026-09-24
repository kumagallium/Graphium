// Wiki 操作ログ（IndexedDB ベース）
// Ingest・Lint 等の操作を時系列で記録する
// llm-wiki の log.md に相当する append-only ログ

const DB_NAME = "graphium-wiki-log";
const DB_VERSION = 1;
const STORE_NAME = "log";

export type WikiLogEventType =
  | "ingest"      // ソースから Wiki を生成
  | "merge"       // 既存 Wiki にマージ
  | "lint"        // 整合性チェック実行
  | "delete"      // Wiki 削除（完全削除ではなくゴミ箱行き）
  | "cross-update" // 横断更新で既存ページを更新
  | "regenerate"  // Wiki を再生成
  | "archive"     // 可逆アーカイブ（空になったナレッジの自動退避・stale/redundant の一括退避）
  | "source-check"; // 出典照合（Source check）実行

export type WikiLogEntry = {
  id: string;
  timestamp: string;
  type: WikiLogEventType;
  /** 影響を受けた Wiki ID */
  wikiIds: string[];
  /** 要約 */
  summary: string;
  /** 詳細データ（タイプ固有） */
  detail?: Record<string, unknown>;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("timestamp", "timestamp", { unique: false });
        store.createIndex("type", "type", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const wikiLog = {
  /** ログエントリを追加 */
  async append(
    type: WikiLogEventType,
    wikiIds: string[],
    summary: string,
    detail?: Record<string, unknown>,
  ): Promise<void> {
    const entry: WikiLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      wikiIds,
      summary,
      detail,
    };

    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** 最新 N 件のログを取得（新しい順） */
  async getRecent(limit: number = 50): Promise<WikiLogEntry[]> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("timestamp");
      const req = index.openCursor(null, "prev");
      const results: WikiLogEntry[] = [];

      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  /** 特定の Wiki に関するログを取得 */
  async getByWikiId(wikiId: string, limit: number = 20): Promise<WikiLogEntry[]> {
    const all = await this.getRecent(200);
    return all
      .filter((e) => e.wikiIds.includes(wikiId))
      .slice(0, limit);
  },

  /** ログを全削除 */
  async clear(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },

  /** 指定タイプの最新ログの timestamp を取得 */
  async getLastTimestamp(type: WikiLogEventType): Promise<string | null> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("type");
      const req = index.openCursor(IDBKeyRange.only(type), "prev");
      // type インデックスは timestamp 順ではないので全件走査して最新を取る
      let latest: string | null = null;
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const entry = cursor.value as WikiLogEntry;
          if (!latest || entry.timestamp > latest) {
            latest = entry.timestamp;
          }
          cursor.continue();
        } else {
          resolve(latest);
        }
      };
      req.onerror = () => reject(req.error);
    });
  },

  /** LLM 向けのログテキストにフォーマット（直近の操作履歴） */
  async formatForLLM(limit: number = 20): Promise<string> {
    const entries = await this.getRecent(limit);
    if (entries.length === 0) return "";

    const lines = entries.map((e) => {
      const date = new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ");
      return `[${date}] ${e.type}: ${e.summary}`;
    });

    return `## Recent Wiki Activity\n\n${lines.join("\n")}`;
  },

  /**
   * 直近 N 日分のログを LLM 向けにフォーマットする（フル点検が「次に調べること」の
   * 優先づけに使う）。件数の恣意的な上限は置かず、期間で切る方針（棚卸し D2）。
   * ログが極端に多い期間があっても、そのまま渡す（コスト警告は別レイヤーの責務）。
   * 見出し（節）は呼び出し元（buildLinterUserMessage）が付けるので、ここでは行だけを返す。
   */
  async formatRecentForLLM(days: number = 7): Promise<string> {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    // getRecent は件数上限が必要な API なので、期間を賄えるだけの件数を広めに取ってから
    // タイムスタンプで絞り込む（型を汚さずに済む最小の実装）。
    const entries = (await this.getRecent(500)).filter(
      (e) => new Date(e.timestamp).getTime() >= sinceMs,
    );
    if (entries.length === 0) return "";

    return entries
      .map((e) => {
        const date = new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ");
        return `[${date}] ${e.type}: ${e.summary}`;
      })
      .join("\n");
  },
};
