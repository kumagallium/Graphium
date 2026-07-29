// 捕獲履歴（旧・送信キュー。store-and-forward）。
//
// SPA の Google トークンは約 1 時間で失効するため、「撮る」と「送る」を分離する:
// 撮ったら即 IndexedDB に永続化（enqueue）→ 認証が生きていれば即 drain、
// 切れていれば「接続して送る」時にまとめて drain。**アップロード失敗・再認証・
// PWA が殺されてもアイテムが失われない**のが最重要の不変条件。
//
// この永続モデルは「未送信の箱」ではなく **捕獲の履歴** である（ユーザー決定）:
// 送信が成功してもレコードは残り、ホームの時系列リストに「送信済み ✓」として
// 並び続ける。キューから消える設計だと、送るほどホームが空になり「撮った手応え」が
// どこにも残らなかった（フラグ ON では捕獲物をローカルにも保存しないため）。
//
// - Blob ごと IndexedDB（独自 DB `graphium-push-queue`）に保存する。File を
//   そのまま structured clone すると環境によって name が落ちる（Node 22 で実測）
//   ため、素の Blob + name フィールドに分けて保存する。
// - **送信成功時はレコードを残し、blob だけ捨てる**（容量対策）。代わりに enqueue 時に
//   焼いた縮小 JPEG（thumbnail）とメモ / URL の 1 行プレビュー（preview）が残るので、
//   blob が無くなっても行の見た目は保たれる。
// - drain は直列。1 件の失敗は attempts++ とバックオフ予約をして次へ進む。
//   PushAuthError だけは全体を中断する（トークン失効はアイテムの責任ではない
//   ので attempts を消費しない — 再接続後にそのまま再送できる）。
// - リトライ上限（MAX_ATTEMPTS）に達したら status="failed" にして drain 対象から
//   外す。UI が retry/remove を提供する。
// - 保持ポリシー: sent は直近 HISTORY_MAX_SENT 件 / HISTORY_MAX_AGE_MS を超えたら
//   古い順に自動削除（drain 後）。**pending / failed は対象外** — 未処理は消さない。
// - 状態購読: subscribePushQueue でスナップショットを受け取れる（UI 用）。
//   Blob・サムネは含めない軽量メタのみ（サムネは getPushQueueThumbnail で個別に読む）。

import {
  captureFilePreview,
  isGraphiumCaptureName,
  parseGraphiumCaptureFile,
} from "../capture-file";
import { normalizeCaptureName } from "./naming";
import { createCaptureThumbnail } from "./thumbnail";
import { PushAuthError, type InboxPusher, type PushProgress } from "./types";

const DB_NAME = "graphium-push-queue";
/** v1 = 未送信キュー / v2 = 捕獲履歴（sent・thumbnail・preview の追加）。 */
const DB_VERSION = 2;
const STORE_NAME = "items";
/** これ以上失敗したら "failed"（UI からの明示 retry 待ち）に落とす。 */
const MAX_ATTEMPTS = 5;
/** バックオフ: BASE * 2^(attempts-1)、上限 MAX。 */
const BACKOFF_BASE_MS = 5 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
/** 履歴に残す送信済みの件数上限（超過分は古い順に削除）。 */
export const HISTORY_MAX_SENT = 100;
/** 送信済みの保持期間（30 日）。 */
export const HISTORY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 履歴レコードの永続状態。"uploading" を持たないのは意図的 —
 * 送信中に PWA が殺されても pending のまま残り、次の drain で再送される。
 * "sent" は送信完了（blob は捨て済み・履歴としてのみ残る）。
 */
export type PushQueueItemStatus = "pending" | "failed" | "sent";

/** IndexedDB に保存するレコード（blob・サムネ込み）。 */
type PushQueueRecord = {
  id: string;
  /** 正規化済みファイル名（graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>）。 */
  name: string;
  mime: string;
  bytes: number;
  /** 送信前の実体。**送信成功で捨てる**（履歴としてのレコードは残る）。 */
  blob?: Blob;
  /** 画像の縮小 JPEG（enqueue 時に生成）。blob 破棄後も履歴の行に絵を残すため。 */
  thumbnail?: Blob;
  /** メモ / URL 捕獲の 1 行プレビュー（blob 破棄後もテキストを残すため）。 */
  preview?: string;
  /** URL 捕獲の URL（行のドメイン表示用）。 */
  previewUrl?: string;
  /** ISO8601。drain はこの昇順で直列処理し、履歴はこの順（の逆）で並ぶ。 */
  enqueuedAt: string;
  /** ISO8601。送信完了時刻（status="sent" のときのみ）。 */
  sentAt?: string;
  status: PushQueueItemStatus;
  attempts: number;
  lastError?: string;
  /** epoch ms。バックオフ中はこの時刻まで drain がスキップする。 */
  nextAttemptAt?: number;
};

/** UI 向けの軽量メタ（Blob 系を含まない）。 */
export type PushQueueItemMeta = Omit<PushQueueRecord, "blob" | "thumbnail">;

/** 状態購読用スナップショット。 */
export type PushQueueSnapshot = {
  /** enqueuedAt 昇順。**送信済み（sent）も含む**（履歴なので消えない）。 */
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

/**
 * DB を開く。v1（未送信キュー）→ v2（捕獲履歴）のマイグレーションは
 * **既存レコードを温存する**のが要件 — 新フィールド（thumbnail / preview / sentAt）は
 * すべて optional なので構造変換は要らず、想定外の status だけ pending に正す
 * （読めないレコードを作らない）。旧ビルドが書いた pending / failed は
 * そのまま次の drain で送られる。
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
        return; // 新規作成 = 移行対象なし
      }
      if (event.oldVersion < 2) {
        // v1 の残キューを 1 件ずつ検分する（削除はしない）
        const store = req.transaction?.objectStore(STORE_NAME);
        if (!store) return;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const record = cursor.value as PushQueueRecord;
          if (record.status !== "pending" && record.status !== "failed") {
            cursor.update({ ...record, status: "pending" });
          }
          cursor.continue();
        };
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

/**
 * 1 レコードを読み → patch を当てて書き戻す（1 トランザクション内）。
 * patch に undefined を明示したフィールドはキーごと落とす（IDB に undefined を残さない）。
 * 送信成功時の blob 破棄もこの経路（`{ blob: undefined }`）で行う。
 */
async function updateRecord(id: string, patch: Partial<PushQueueRecord>): Promise<void> {
  await runTx("readwrite", (store) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const current = getReq.result as PushQueueRecord | undefined;
      if (!current) return; // 並行削除された場合は何もしない
      const merged = { ...current, ...patch } as Record<string, unknown>;
      for (const key of Object.keys(patch)) {
        if (patch[key as keyof PushQueueRecord] === undefined) delete merged[key];
      }
      store.put(merged);
    };
  });
}

// ── 状態購読 ──

let draining = false;
let activeId: string | null = null;
const listeners = new Set<(snapshot: PushQueueSnapshot) => void>();

function toMeta(record: PushQueueRecord): PushQueueItemMeta {
  const { blob: _blob, thumbnail: _thumbnail, ...meta } = record;
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
 * メモ / URL 捕獲（capture-file.ts の JSON）の 1 行プレビューを読み出す。
 * blob を捨てた後の履歴行でもテキストが残るよう、enqueue の時点でレコードに写す。
 * 読めない・形状不正は undefined（行はファイル名表示に倒れるだけ）。
 */
async function extractCapturePreview(
  file: File,
  name: string,
): Promise<{ preview?: string; previewUrl?: string }> {
  if (!isGraphiumCaptureName(name)) return {};
  try {
    const payload = parseGraphiumCaptureFile(name, await file.text());
    if (!payload) return {};
    return {
      preview: captureFilePreview(payload),
      ...(payload.kind === "url" ? { previewUrl: payload.url } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * 画像レコードにサムネイル（縮小 JPEG）を後付けする。**blob 永続化の後**に走らせる —
 * デコードは重く、その間に PWA が殺されても実体だけは既に永続化されている、という順番。
 * 生成できない環境・失敗は黙って諦める（履歴行は種別アイコンに倒れる）。
 */
async function attachThumbnails(records: PushQueueRecord[], files: File[]): Promise<void> {
  await Promise.all(
    records.map(async (record, index) => {
      if (!record.mime.startsWith("image/")) return;
      try {
        const thumbnail = await createCaptureThumbnail(files[index], record.mime);
        if (thumbnail) await updateRecord(record.id, { thumbnail });
      } catch {
        // サムネが無いだけ。履歴レコード自体は成立している
      }
    }),
  );
}

/**
 * ファイル群を捕獲履歴に積む（撮った直後に呼ぶ）。名前は
 * `graphium-<YYYYMMDD-HHmmss>-<連番>.<ext>` に正規化される（連番は呼び出し内で 1..N）。
 * Blob ごと IndexedDB に永続化するので、この Promise が resolve した時点で
 * PWA が殺されてもアイテムは失われない。IndexedDB が使えない環境では reject する
 * （呼び出し側はローカル保存等へフォールバックする）。
 *
 * 画像には縮小サムネイル、メモ / URL には 1 行プレビューを併せて持たせる —
 * 送信成功で blob を捨てた後も、履歴の行に「何を撮ったか」を残すため。
 */
export async function enqueuePushFiles(files: File[]): Promise<PushQueueItemMeta[]> {
  if (files.length === 0) return [];
  const when = new Date();
  const records: PushQueueRecord[] = await Promise.all(
    files.map(async (file, index) => {
      const mime = file.type || "application/octet-stream";
      const name = normalizeCaptureName({
        mime,
        originalName: file.name,
        when,
        seq: index + 1,
      });
      return {
        id: newId(),
        name,
        mime,
        bytes: file.size,
        // File のまま clone すると環境により name が落ちるため素の Blob に落とす
        blob: new Blob([file], { type: mime }),
        ...(await extractCapturePreview(file, name)),
        enqueuedAt: when.toISOString(),
        status: "pending" as const,
        attempts: 0,
      };
    }),
  );
  await putRecords(records);
  await emit();
  // サムネは実体の永続化より後（重い処理の前に「失わない」を確定させる）
  await attachThumbnails(records, files);
  return records.map(toMeta);
}

/**
 * 未送信アイテムを File として復元する（enqueue 順）。ids を渡すとその id のみ。
 * 名前・MIME は enqueue 時に正規化済みのものをそのまま使う。
 * **送信済み（blob を捨てたレコード）は返らない** — 履歴として名前とサムネだけが残る。
 *
 * 用途: Web Share フォールバック（Google 未設定環境）、UI のプレビュー。UI は
 * snapshot（メタのみ）で一覧を描き、実体が要るときだけこの API で復元する。
 */
export async function getPushQueueFiles(
  ids?: string[],
): Promise<Array<{ id: string; file: File }>> {
  const records = (await getAllRecords()).sort(sortByEnqueuedAt);
  const wanted = ids ? new Set(ids) : null;
  return records
    .filter((record) => (wanted ? wanted.has(record.id) : true))
    .filter((record): record is PushQueueRecord & { blob: Blob } => !!record.blob)
    .map((record) => ({
      id: record.id,
      file: new File([record.blob], record.name, { type: record.mime }),
    }));
}

/**
 * 履歴行のサムネイル画像を読む。enqueue 時に焼いた縮小 JPEG を返し、
 * まだ焼けていない（旧レコード・生成失敗）画像は未送信なら実体 blob で代用する。
 * 該当なし・画像でない場合は null（呼び出し側は種別アイコンに倒す）。
 */
export async function getPushQueueThumbnail(id: string): Promise<Blob | null> {
  const record = (await getAllRecords()).find((item) => item.id === id);
  if (!record) return null;
  if (record.thumbnail) return record.thumbnail;
  if (record.blob && record.mime.startsWith("image/")) return record.blob;
  return null;
}

/** アイテムを 1 件取り下げる（未送信の取り下げ・履歴からの手動削除の両方）。 */
export async function removePushQueueItem(id: string): Promise<void> {
  await deleteRecord(id);
  await emit();
}

/**
 * 送信済み（sent）の履歴を保持ポリシーまで刈る: 直近 HISTORY_MAX_SENT 件 /
 * HISTORY_MAX_AGE_MS 以内。超過分は古い順に削除する。
 * **pending / failed は対象外** — 未処理の捕獲物を時間や件数で捨てない。
 * 呼びどころ: drain 後（sent が増える唯一の契機）。
 */
export async function prunePushQueueHistory(opts?: { now?: number }): Promise<number> {
  const now = opts?.now ?? Date.now();
  const sent = (await getAllRecords())
    .filter((record) => record.status === "sent")
    .sort(sortByEnqueuedAt);
  const cutoff = now - HISTORY_MAX_AGE_MS;
  const expired = sent.filter(
    (record) => new Date(record.sentAt ?? record.enqueuedAt).getTime() < cutoff,
  );
  const overflow = sent.slice(0, Math.max(0, sent.length - HISTORY_MAX_SENT));
  const doomed = new Set([...expired, ...overflow].map((record) => record.id));
  if (doomed.size === 0) return 0;
  await runTx("readwrite", (store) => {
    for (const id of doomed) store.delete(id);
  });
  await emit();
  return doomed.size;
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

/** 履歴ごと全部消す（テスト・明示的な全破棄用。送信済みの記録も残らない）。 */
export async function clearPushQueue(): Promise<void> {
  await runTx("readwrite", (store) => store.clear());
  await emit();
}

function backoffDelayMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_MAX_MS);
}

/**
 * 未送信（pending）を直列に送る。呼びどころ: enqueue 直後（接続済みなら）、接続完了直後、
 * アプリのフォアグラウンド復帰など。多重呼び出しは "busy" で即返る。
 *
 * - 成功したアイテムは **status="sent" + sentAt で履歴に残し、blob だけ捨てる**
 *   （容量対策。サムネ・プレビューは残るので行の見た目は保たれる）。
 *   走り終えたら保持ポリシー（直近 100 件 / 30 日）で古い sent を刈る。
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
      if (!record.blob) {
        // 実体を失った pending（本来ありえない）。無限ループを避けて failed に落とす
        await updateRecord(record.id, {
          status: "failed",
          lastError: "capture data is missing",
          nextAttemptAt: undefined,
        });
        result.failed.push({
          id: record.id,
          name: record.name,
          error: "capture data is missing",
        });
        continue;
      }
      activeId = record.id;
      await emit();
      try {
        const file = new File([record.blob], record.name, { type: record.mime });
        const pushed = await pusher.push(file, {
          onProgress: (progress) => opts?.onItemProgress?.(record.id, progress),
        });
        // 送信完了。レコードは履歴として残し、実体（blob）だけ捨てる
        await updateRecord(record.id, {
          status: "sent",
          sentAt: new Date().toISOString(),
          blob: undefined,
          lastError: undefined,
          nextAttemptAt: undefined,
        });
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
    if (result.pushed.length > 0) {
      // 保持ポリシーは sent が増えた直後だけ効かせれば足りる
      await prunePushQueueHistory().catch(() => {});
    }
    await emit();
  }
}
