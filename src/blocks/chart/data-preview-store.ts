// データ素材の下見（列名・行数・線の形）の共有ストア
//
// チャートのデータピッカーと素材一覧の両方が、同じ素材の下見を使う。どちらで読んでも
// fileId 単位でここに溜め、もう片方では読み直さない。
//
// - 読み込みは待ち行列で同時 MAX_CONCURRENT 本まで（一覧は数百件あり得るため）
// - 依頼は取り消せる。まだ始まっていない分だけを行列から外す（閉じたピッカーや
//   画面外に出た行のために読み続けない）。同じ fileId を複数の場所が依頼した場合は、
//   全員が取り消したときだけ外す
// - 失敗は溜めるが、retryFailedDataPreviews で忘れられる（ピッカーを開き直したときに再試行）

import { useEffect, useSyncExternalStore } from "react";
import { loadAssetText } from "../../features/data-import/asset-text";
import { analyzeDataTextAsync, type DataPreview } from "./data-preview";

/** 同時に読む本数 */
const MAX_CONCURRENT = 4;

const cache = new Map<string, DataPreview>();
const failed = new Set<string>();
const inflight = new Set<string>();
/** 待ち行列（先頭から読む）。値は依頼している場所の数 */
const queued = new Map<string, number>();
const listeners = new Set<() => void>();
/** 変化のたびに進める版（useSyncExternalStore のスナップショット） */
let version = 0;

export type DataPreviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "ready"; preview: DataPreview };

function notify() {
  version++;
  listeners.forEach((fn) => fn());
}

function pump() {
  for (const id of queued.keys()) {
    if (inflight.size >= MAX_CONCURRENT) return;
    queued.delete(id);
    inflight.add(id);
    void loadAssetText(id)
      // 大きいファイルは全文を読むので、非同期版で UI を止めない
      .then((text) => analyzeDataTextAsync(text))
      .then(
        (p) => {
          cache.set(id, p);
        },
        () => {
          failed.add(id);
        },
      )
      .then(() => {
        inflight.delete(id);
        notify();
        pump();
      });
  }
}

/** いまの状態（読み込みを始めはしない） */
export function getDataPreviewState(fileId: string): DataPreviewState {
  const p = cache.get(fileId);
  if (p) return { kind: "ready", preview: p };
  if (failed.has(fileId)) return { kind: "failed" };
  if (inflight.has(fileId) || queued.has(fileId)) return { kind: "loading" };
  return { kind: "idle" };
}

/**
 * 下見を依頼する。読み終わっている・失敗済み・読み込み中なら何もしない。
 * 返す関数で依頼を取り消す（まだ始まっていなければ行列から外れる）。
 */
export function requestDataPreview(fileId: string): () => void {
  if (cache.has(fileId) || failed.has(fileId) || inflight.has(fileId)) return () => {};
  queued.set(fileId, (queued.get(fileId) ?? 0) + 1);
  pump();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const n = queued.get(fileId);
    if (n === undefined) return; // もう始まった（か終わった）
    if (n <= 1) queued.delete(fileId);
    else queued.set(fileId, n - 1);
  };
}

/** 失敗した素材を忘れる（次の依頼で読み直す） */
export function retryFailedDataPreviews(): void {
  if (failed.size === 0) return;
  failed.clear();
  notify();
}

export function subscribeDataPreviews(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** テスト・ストーリー用: 下見のキャッシュと失敗の記録を空にする */
export function clearDataPreviewCache(): void {
  cache.clear();
  failed.clear();
  notify();
}

function getVersion() {
  return version;
}

/**
 * 1 件の下見を購読する。enabled が true のあいだ読み込みを依頼する
 * （一覧では画面に入ってから true にする）。
 */
export function useDataPreview(fileId: string, enabled = true): DataPreviewState {
  useSyncExternalStore(subscribeDataPreviews, getVersion);
  useEffect(() => {
    if (!enabled) return;
    return requestDataPreview(fileId);
  }, [fileId, enabled]);
  return getDataPreviewState(fileId);
}
