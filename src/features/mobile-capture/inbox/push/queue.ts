// 送信キュー（store-and-forward）。
//
// SPA の Google トークンは約 1 時間で失効するため、「撮る」と「送る」を分離する:
// 撮ったら即 IndexedDB に永続化（enqueue）→ 認証が生きていれば即 drain、
// 切れていれば「接続して送る」時にまとめて drain。**アップロード失敗・再認証・
// PWA が殺されてもキューのアイテムが失われない**のが最重要の不変条件。
//
// - Blob ごと IndexedDB（独自 DB `graphium-push-queue`）に保存する。File を
//   そのまま structured clone すると環境によって name が落ちる（Node 22 で実測）
//   ため、素の Blob + name フィールドに分けて保存する。
// - drain は直列。1 件の失敗は attempts++ とバックオフ予約をして次へ進む。
//   PushAuthError だけは全体を中断する（トークン失効はアイテムの責任ではない
//   ので attempts を消費しない — 再接続後にそのまま再送できる）。
// - リトライ上限（MAX_ATTEMPTS）に達したら status="failed" にして drain 対象から
//   外す。UI（セッション 2）が retry/remove を提供する。
// - 状態購読: subscribePushQueue でスナップショットを受け取れる（UI 用）。
//   Blob は含めない軽量メタのみ。

import { normalizeCaptureName } from "./naming";
import { PushAuthError, type InboxPusher, type PushProgress } from "./types";

const DB_NAME = "graphium-push-queue";
const DB_VERSION = 1;
const STORE_NAME = "items";
/** これ以上失敗したら "failed"（UI からの明示 retry 待ち）に落とす。 */
const MAX_ATTEMPTS = 5;
/** バックオフ: BASE * 2^(attempts-1)、上限 MAX。 */
const BACKOFF_BASE_MS = 5 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/** キューアイテムの永続状態。"uploading" を持たないのは意図的 —
 * 送信中に PWA が殺されても pending のまま残り、次の drain で再送される。 */
export type PushQueueItemStatus = "pending" | "failed";

/** IndexedDB に保存するレコード（blob 込み）。 */
type PushQueueRecord = {
  id: string;
  /** 正規化済みファイル名（graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>）。 */
  name: string;
  mime: string;
  bytes: number;
  blob: Blob;
  /** ISO8601。drain はこの昇順で直列処理する。 */
  enqueuedAt: string;
  status: PushQueueItemStatus;
  attempts: number;
  lastError?: string;
  /** epoch ms。バックオフ中はこの時刻まで drain がスキップする。 */
  nextAttemptAt?: number;
};

/** UI 向けの軽量メタ（blob を含まない）。 */
export type PushQueueItemMeta = Omit<PushQueueRecord, "blob">;

/** 状態購読用スナップショット。 */
export type PushQueueSnapshot = {
  /** enqueuedAt 昇順。 */
  items: PushQueueItemMeta[];
  /** drain 実行中か。 */
  draining: boolean;
  /** 送信中アイテムの id（drain 中のみ）。 */
  activeId: string | null;
};

/** drain の結果。 */
export type DrainResult = {
  pushed: Array<{ id: string; name: string; fileId: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
  /** バックオフ待ちでスキップした id。 */
  deferred: string[];
  /**
   * 中断理由。"auth" = 認証切れ（残りは pending のまま保全、attempts 消費なし）。
   * "busy" = 既に drain 実行中（何もしていない）。null = 最後まで走った。
   */
  aborted: "auth" | "busy" | null;
};

// ── IndexedDB ヘルパー（embedding-store.ts と同型の open-per-op） ──

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * 1 トランザクションで store を操作する。fn は同期でリクエストを積むこと
 * （await を挟むと IDB のトランザクションが auto-commit で閉じる）。
 * resolve は tx.oncomplete 後（= fn が積んだ書き込みが確定した後）。
 */
async function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T,
): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    let result: T;
    try {
      result = fn(tx.objectStore(STORE_NAME));
    } catch (err) {
      db.close();
      reject(err);
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("push queue transaction failed"));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error("push queue transaction aborted"));
    };
  });
}

async function getAllRecords(): Promise<PushQueueRecord[]> {
  const req = await runTx("readonly", (store) => store.getAll());
  return (req.result as PushQueueRecord[]) ?? [];
}

function sortByEnqueuedAt(a: PushQueueRecord, b: PushQueueRecord): number {
  // 同一バッチは enqueuedAt が同値なので、連番入りの name で撮った順を保つ
  return (
    a.enqueuedAt.localeCompare(b.enqueuedAt) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

async function putRecords(records: PushQueueRecord[]): Promise<void> {
  await runTx("readwrite", (store) => {
    for (const record of records) store.put(record);
  });
}

async function deleteRecord(id: string): Promise<void> {
  await runTx("readwrite", (store) => store.delete(id));
}

/** 1 レコードを読み → patch を当てて書き戻す（1 トランザクション内）。 */
async function updateRecord(id: string, patch: Partial<PushQueueRecord>): Promise<void> {
  await runTx("readwrite", (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result as PushQueueRecord | undefined;
      if (!current) return; // 並行削除された場合は何もしない
      const merged: PushQueueRecord = { ...current, ...patch };
      // undefined を明示指定されたフィールドはキーごと落とす（IDB に undefined を残さない）
      if (merged.lastError === undefined) delete merged.lastError;
      if (merged.nextAttemptAt === undefined) delete merged.nextAttemptAt;
      store.put(merged);
    };
  });
}

// ── 状態購読 ──

let draining = false;
let activeId: string | null = null;
const listeners = new Set<(snapshot: PushQueueSnapshot) => void>();

function toMeta(record: PushQueueRecord): PushQueueItemMeta {
  const { blob: _blob, ...meta } = record;
  return meta;
}

async function computeSnapshot(): Promise<PushQueueSnapshot> {
  const records = (await getAllRecords()).sort(sortByEnqueuedAt);
  return { items: records.map(toMeta), draining, activeId };
}

async function emit(): Promise<void> {
  if (listeners.size === 0) return;
  const snapshot = await computeSnapshot();
  for (const listener of listeners) listener(snapshot);
}

/**
 * キューの状態変化を購読する（UI 用）。購読直後に現在値が一度流れる。
 * 返り値で解除。
 */
export function subscribePushQueue(
  listener: (snapshot: PushQueueSnapshot) => void,
): () => void {
  listeners.add(listener);
  // 初期スナップショットを非同期で届ける（失敗は握る — 購読自体は成立させる）
  computeSnapshot()
    .then((snapshot) => {
      if (listeners.has(listener)) listener(snapshot);
    })
    .catch(() => {});
  return () => {
    listeners.delete(listener);
  };
}

/** 現在のスナップショットを取得する（購読せずに一度だけ読む用）。 */
export function getPushQueueSnapshot(): Promise<PushQueueSnapshot> {
  return computeSnapshot();
}

// ── 操作 ──

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `push-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * ファイル群をキューに積む（撮った直後に呼ぶ）。名前は
 * `graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>` に正規化される（連番は呼び出し内で 1..N）。
 * Blob ごと IndexedDB に永続化するので、この Promise が resolve した時点で
 * PWA が殺されてもアイテムは失われない。IndexedDB が使えない環境では reject する
 * （呼び出し側はローカル保存等へフォールバックする）。
 */
export async function enqueuePushFiles(files: File[]): Promise<PushQueueItemMeta[]> {
  if (files.length === 0) return [];
  const when = new Date();
  const records: PushQueueRecord[] = files.map((file, index) => {
    const mime = file.type || "application/octet-stream";
    return {
      id: newId(),
      name: normalizeCaptureName({
        mime,
        originalName: file.name,
        when,
        seq: index + 1,
      }),
      mime,
      bytes: file.size,
      // File のまま clone すると環境により name が落ちるため素の Blob に落とす
      blob: new Blob([file], { type: mime }),
      enqueuedAt: when.toISOString(),
      status: "pending",
      attempts: 0,
    };
  });
  await putRecords(records);
  await emit();
  return records.map(toMeta);
}

/** アイテムを 1 件取り下げる（UI の削除操作用）。 */
export async function removePushQueueItem(id: string): Promise<void> {
  await deleteRecord(id);
  await emit();
}

/** failed のアイテムを pending に戻す（attempts リセット）。UI の「再試行」用。 */
export async function retryFailedPushItems(): Promise<void> {
  const records = await getAllRecords();
  const failed = records.filter((record) => record.status === "failed");
  if (failed.length === 0) return;
  await putRecords(
    failed.map((record) => {
      const revived: PushQueueRecord = { ...record, status: "pending", attempts: 0 };
      delete revived.lastError;
      delete revived.nextAttemptAt;
      return revived;
    }),
  );
  await emit();
}

/** キューを空にする（テスト・明示的な全破棄用）。 */
export async function clearPushQueue(): Promise<void> {
  await runTx("readwrite", (store) => store.clear());
  await emit();
}

function backoffDelayMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
}

/**
 * キューを直列に送る。呼びどころ: enqueue 直後（接続済みなら）、接続完了直後、
 * アプリのフォアグラウンド復帰など。多重呼び出しは "busy" で即返る。
 *
 * - 成功したアイテムは削除。
 * - 失敗は attempts++ / lastError / バックオフ予約をして**次のアイテムへ進む**。
 *   attempts が上限に達したら "failed" に落とす。
 * - PushAuthError は**全体を中断**する（aborted:"auth"）。残りは pending のまま、
 *   attempts も消費しない。バックオフ待ち（nextAttemptAt 未来）は deferred として
 *   スキップする。
 */
export async function drainPushQueue(
  pusher: InboxPusher,
  opts?: { onItemProgress?: (id: string, progress: PushProgress) => void },
): Promise<DrainResult> {
  if (draining) return { pushed: [], failed: [], deferred: [], aborted: "busy" };
  draining = true;
  const result: DrainResult = { pushed: [], failed: [], deferred: [], aborted: null };
  try {
    await emit();
    const records = (await getAllRecords())
      .filter((record) => record.status === "pending")
      .sort(sortByEnqueuedAt);

    for (const record of records) {
      if (record.nextAttemptAt !== undefined && record.nextAttemptAt > Date.now()) {
        result.deferred.push(record.id);
        continue;
      }
      if (!pusher.isConnected()) {
        // 事前判定でも中断できるようにしておく（push まで行けば PushAuthError でも中断する）
        result.aborted = "auth";
        break;
      }
      activeId = record.id;
      await emit();
      try {
        const file = new File([record.blob], record.name, { type: record.mime });
        const pushed = await pusher.push(file, {
          onProgress: (progress) => opts?.onItemProgress?.(record.id, progress),
        });
        await deleteRecord(record.id);
        result.pushed.push({ id: record.id, name: record.name, fileId: pushed.fileId });
      } catch (err) {
        if (err instanceof PushAuthError) {
          result.aborted = "auth";
          activeId = null;
          break;
        }
        const attempts = record.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        if (attempts >= MAX_ATTEMPTS) {
          await updateRecord(record.id, {
            attempts,
            lastError: message,
            status: "failed",
            nextAttemptAt: undefined,
          });
        } else {
          await updateRecord(record.id, {
            attempts,
            lastError: message,
            nextAttemptAt: Date.now() + backoffDelayMs(attempts),
          });
        }
        result.failed.push({ id: record.id, name: record.name, error: message });
      } finally {
        activeId = null;
      }
      await emit();
    }
    return result;
  } finally {
    draining = false;
    activeId = null;
    await emit();
  }
}
