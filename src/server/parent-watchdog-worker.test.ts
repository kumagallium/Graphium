// 保険の見張り（worker）のテスト。
//
// 確かめたいのは「メインスレッドのイベントループが塞がっていても、親が消えたら
// プロセスが止まる」こと。偽物では確かめられないので、実際に node の子プロセスを
// 起こし、無限ループでメインスレッドを塞いだ状態で見る。

import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { HARD_WATCHDOG_WORKER_SOURCE, startHardParentWatchdog } from "./parent-watchdog-worker.js";

/** すでに終了したプロセスの PID を作る（「消えた親」の役） */
function deadPid(): number {
  const r = spawnSync(process.execPath, ["-e", ""]);
  if (!r.pid) throw new Error("failed to spawn a throwaway process");
  return r.pid;
}

/** 見張りを付けてからメインスレッドを無限ループで塞ぐ子プロセスを起こし、終わり方を返す */
function runBlockedChild(parentPid: number, timeoutMs: number) {
  const script = `
    const { Worker } = require("node:worker_threads");
    new Worker(${JSON.stringify(HARD_WATCHDOG_WORKER_SOURCE)}, {
      eval: true,
      workerData: { parentPid: ${parentPid}, intervalMs: 50, graceMs: 50 },
    });
    // SIGTERM のハンドラがある sidecar と同じ条件にする（既定の即死を外す）
    process.on("SIGTERM", () => process.exit(0));
    while (true) {}
  `;
  return new Promise<{ signal: NodeJS.Signals | null; timedOut: boolean }>((resolve) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ signal: null, timedOut: true });
    }, timeoutMs);
    child.on("exit", (_code, signal) => {
      clearTimeout(timer);
      resolve({ signal, timedOut: false });
    });
  });
}

describe("hard parent watchdog (worker)", () => {
  it("親が消えていれば、メインスレッドが塞がっていても自分を止める", async () => {
    const result = await runBlockedChild(deadPid(), 10_000);
    expect(result.timedOut).toBe(false);
    if (process.platform !== "win32") expect(result.signal).toBe("SIGKILL");
  }, 15_000);

  it("親が生きている間は止めない", async () => {
    // 親 = このテストのプロセス。1.5 秒待っても生きていることを見る
    const result = await runBlockedChild(process.pid, 1_500);
    expect(result.timedOut).toBe(true);
  }, 15_000);

  it("親 PID が不正なら起動しない", () => {
    expect(startHardParentWatchdog({ parentPid: Number.NaN })).toBeNull();
    expect(startHardParentWatchdog({ parentPid: 0 })).toBeNull();
  });

  it("親 PID が正しければ worker が起動する", async () => {
    const worker = startHardParentWatchdog({ parentPid: process.pid, intervalMs: 50 });
    expect(worker).not.toBeNull();
    await worker?.terminate();
  });
});
