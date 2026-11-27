// 親プロセスの見張りの「保険」— イベントループが塞がっていても効く側。
//
// index.ts の startParentWatchdog は setInterval で親 PID を確かめ、消えていたら
// process.exit する。ただしこれはメインスレッドのイベントループで動くので、重い
// 同期処理でループが塞がっている間は回らない。同じ理由で SIGTERM のハンドラ
// （process-lifecycle.ts）も走らない。その状態で本体が終了すると、sidecar は
// port 3001 を握ったまま残り、次の起動でバックエンドが立ち上がらなくなる
// （v0.173.8 でコスト再計算が何時間もループを塞いだときに踏んだ）。
//
// worker は自分のイベントループを持つので、メインスレッドが塞がっていても回る。
// 親が消えたのを見つけたら、まずメインスレッド側の穏やかな終了（ログを残して
// exit(0)）に猶予を与え、それでもプロセスが残っていれば SIGKILL で自分ごと落とす。
// SIGKILL はハンドラを通らないので、塞がったメインスレッドでも止まる。

import { Worker } from "node:worker_threads";

export type HardWatchdogOptions = {
  parentPid: number;
  /** 親の生存を確かめる間隔 */
  intervalMs?: number;
  /** 親が消えてから SIGKILL するまでの猶予（メインスレッドの穏やかな終了を待つ） */
  graceMs?: number;
};

/**
 * worker の中身。bundle（server.mjs 1 ファイル）から別ファイルを参照しなくて済むよう、
 * 文字列で持って eval で起動する（eval の worker は CommonJS として評価される）。
 *
 * 「消えた」と見なすのは ESRCH だけ。EPERM はプロセスが居る印なので落とさない。
 */
export const HARD_WATCHDOG_WORKER_SOURCE = `
const { workerData } = require("node:worker_threads");
const { parentPid, intervalMs, graceMs } = workerData;
const timer = setInterval(() => {
  try {
    process.kill(parentPid, 0);
  } catch (e) {
    if (!e || e.code !== "ESRCH") return;
    clearInterval(timer);
    setTimeout(() => process.kill(process.pid, "SIGKILL"), graceMs);
  }
}, intervalMs);
`;

/**
 * 保険の見張りを起動する。worker はプロセスを延命させない（unref）。
 * 起動に失敗しても sidecar 自体は動かす（メインスレッド側の見張りは別に回っている）。
 */
export function startHardParentWatchdog(opts: HardWatchdogOptions): Worker | null {
  const { parentPid, intervalMs = 2000, graceMs = 5000 } = opts;
  if (!Number.isInteger(parentPid) || parentPid <= 0) return null;
  try {
    const worker = new Worker(HARD_WATCHDOG_WORKER_SOURCE, {
      eval: true,
      workerData: { parentPid, intervalMs, graceMs },
      // 見張りは出力しない。メインの stdout/stderr に繋がない
      stdout: false,
      stderr: false,
    });
    // worker 側の想定外の失敗でメインを落とさない
    worker.on("error", () => {});
    worker.unref();
    return worker;
  } catch {
    return null;
  }
}
