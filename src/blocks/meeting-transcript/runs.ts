// 音声ノートの清書・要約の実行を、録音ごとに 1 か所で覚える
//
// 実行中かどうかをブロックの画面（React の ref / state）だけで持つと、実行中にノートを
// 開き直したりサイドピークで同じノートを開いたりしたとき、新しい画面からもう一度押せて、
// 同じ録音の清書・要約が 2 本同時に AI へ送られる。ローカルの LLM では 2 本が同じ文脈の枠を
// 取り合って両方とも失敗する。ここで録音（fileId）と種類ごとに 1 本だけにし、
// 進み具合・失敗の文・できた結果を、どの画面からでも読めるようにする。

import { useSyncExternalStore } from "react";

export type RunKind = "cleanup" | "summary";

/** 進み具合。etaMs は残り時間の目安（1 回以上終わってから。それまでの 1 回あたりの時間から） */
export type RunProgress = { done: number; total: number; etaMs?: number };

export type RunSnapshot<T = unknown> = {
  /** 実行中なら進み具合（要約は 0 / 1）。実行中でなければ null */
  progress: RunProgress | null;
  /** 直近の失敗の文（次の実行を始めると消える） */
  error: string | null;
  /** 直近にできた結果。完了のたびに別のオブジェクトになる（画面はこれの変化で取り込む） */
  result: { value: T } | null;
};

const EMPTY: RunSnapshot = { progress: null, error: null, result: null };
const runs = new Map<string, RunSnapshot>();
const listeners = new Set<() => void>();

const keyOf = (fileId: string, kind: RunKind) => `${kind}:${fileId}`;

function set(key: string, patch: Partial<RunSnapshot>): void {
  runs.set(key, { ...(runs.get(key) ?? EMPTY), ...patch });
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getRun<T = unknown>(fileId: string, kind: RunKind): RunSnapshot<T> {
  return (runs.get(keyOf(fileId, kind)) ?? EMPTY) as RunSnapshot<T>;
}

export function useRun<T = unknown>(fileId: string, kind: RunKind): RunSnapshot<T> {
  return useSyncExternalStore(subscribe, () => getRun<T>(fileId, kind), () => getRun<T>(fileId, kind));
}

export function isRunning(fileId: string, kind: RunKind): boolean {
  return getRun(fileId, kind).progress !== null;
}

/**
 * 実行を始める。同じ録音・種類が実行中なら何もせず false。
 * work は進み具合を onProgress で知らせ、できた結果と、結果はあるが知らせたい失敗（保存できなかったなど）を
 * 返す。投げたものは fail で画面に出す文にする
 */
export function startRun<T>(
  fileId: string,
  kind: RunKind,
  work: (onProgress: (done: number, total: number) => void) => Promise<{ value: T; warning?: string }>,
  fail: (e: unknown) => string,
): boolean {
  if (!fileId || isRunning(fileId, kind)) return false;
  const key = keyOf(fileId, kind);
  set(key, { progress: { done: 0, total: 1 }, error: null });
  const startedAt = Date.now();
  void (async () => {
    try {
      const { value, warning } = await work((done, total) =>
        set(key, { progress: { done, total, ...etaOf(startedAt, done, total) } }),
      );
      set(key, { progress: null, error: warning ?? null, result: { value } });
    } catch (e) {
      set(key, { progress: null, error: fail(e) });
    }
  })();
  return true;
}

/**
 * 残り時間の目安。終わった回数とかかった時間から、残りの回数分を見積もる
 * （ローカルのモデルは 1 回に数分かかることがあり、待つかどうかの判断材料にする）
 */
export function etaOf(startedAt: number, done: number, total: number, now = Date.now()): { etaMs?: number } {
  if (done <= 0 || done >= total) return {};
  return { etaMs: Math.round(((now - startedAt) / done) * (total - done)) };
}

/** テスト用: すべて忘れる */
export function __resetRunsForTest(): void {
  runs.clear();
  listeners.forEach((l) => l());
}
