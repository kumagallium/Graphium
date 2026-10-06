// 起動中のアプリとの競合を避ける判定と、MCP どうしの排他ロック。
// 仕様: docs/internal/mcp-upkeep-stage3-spec-2026-10.md §2.2 / §2.3
// ・ハートビート（`<root>/appdata/app-heartbeat.json`）を読んで「Graphium が起動中か」を判定する
// ・書き換え系ツールは `<root>/appdata/mcp-write-lock.json` を取ってから動く

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** pid が無い（web 版）ハートビートを「起動中」とみなす鮮度（秒） */
export const WEB_FRESH_SEC = 90;
/**
 * pid ありのハートビートがこれより古ければ pid の使い回しとみなす（秒）。
 * Rust のスレッドはスリープ復帰直後だと最大 30 秒書き込めないので、短くすると起動中を通してしまう。
 * 迷ったら断る側に倒す（24 時間）
 */
export const PID_STALE_SEC = 24 * 60 * 60;
/** 書き込みロックがこれより古ければ奪える（秒） */
export const LOCK_STALE_SEC = 60;

const HEARTBEAT_FILE = "app-heartbeat.json";
const LOCK_FILE = "mcp-write-lock.json";

export type Heartbeat = {
  pid?: number;
  via?: string;
  /** ISO 8601 か、終了を知らせる 0 */
  at?: string | number;
  startedAt?: string;
  version?: string;
};

export type RunningReason = "pid-alive" | "fresh" | "no-heartbeat" | "pid-dead" | "pid-reused" | "stale" | "exited";

export type RunningResult = {
  running: boolean;
  reason: RunningReason;
  /** `at` からの経過秒（わかるときだけ） */
  ageSec?: number;
  via?: string;
};

export type GuardDeps = {
  /** pid の生死。既定は process.kill(pid, 0)（ESRCH は死んでいる、成功と EPERM は生きている） */
  isPidAlive?: (pid: number) => boolean;
  now?: () => number;
};

export function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM は「存在するが権限がない」＝生きている。ESRCH だけ死んでいる
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function appdataPath(root: string, file: string): string {
  return join(root, "appdata", file);
}

async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/** 同じディレクトリに `<name>.tmp-<pid>` を書いて rename（失敗したら一時ファイルを消す） */
async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/** ハートビートを読む。無い・壊れていれば null */
export async function readHeartbeat(root: string): Promise<Heartbeat | null> {
  const v = await readJson(appdataPath(root, HEARTBEAT_FILE));
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Heartbeat;
}

/** `at`（ISO 文字列）を ms にする。0・不正は null（終了済み／不明） */
function parseAt(at: unknown): number | null {
  if (typeof at !== "string") return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/** Graphium が起動中かを判定する（仕様 §2.2 の疑似コードどおり） */
export async function detectRunningApp(root: string, deps: GuardDeps = {}): Promise<RunningResult> {
  const hb = await readHeartbeat(root);
  if (!hb) return { running: false, reason: "no-heartbeat" };
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const now = (deps.now ?? Date.now)();
  const atMs = parseAt(hb.at);
  const ageSec = atMs === null ? undefined : Math.floor((now - atMs) / 1000);
  const via = typeof hb.via === "string" ? hb.via : undefined;
  const base = { ageSec, via };

  if (typeof hb.pid === "number" && Number.isInteger(hb.pid) && hb.pid > 0) {
    if (!isPidAlive(hb.pid)) return { running: false, reason: "pid-dead", ...base };
    // 終了時に消し損ねた古いファイルの pid を別プロセスが使い回している場合
    if (ageSec === undefined || ageSec > PID_STALE_SEC) return { running: false, reason: "pid-reused", ...base };
    return { running: true, reason: "pid-alive", ...base };
  }

  // pid なし（web 版）: at: 0（pagehide）や不正値は終了済み
  if (ageSec === undefined) return { running: false, reason: "exited", ...base };
  if (ageSec <= WEB_FRESH_SEC) return { running: true, reason: "fresh", ...base };
  return { running: false, reason: "stale", ...base };
}

/** 断る文。先頭の `APP_RUNNING:` で e2e が判定する */
export function appRunningMessage(result: RunningResult): string {
  let msg =
    "APP_RUNNING: Graphium が起動中のため、ナレッジの書き換えはできません。" +
    "Graphium を終了してからもう一度お試しください（読むことはできます）。";
  if (result.reason === "pid-alive") {
    msg +=
      "Graphium を終了しているのにこの表示が出るときは、Graphium を一度起動してから終了してください" +
      "（前回の終了の記録が残っています）。";
  }
  if (result.via === "web") {
    const age = result.ageSec !== undefined ? `（最後の確認は ${Math.max(0, result.ageSec)} 秒前）` : "";
    msg += `ブラウザ版の起動は、終了後 90 秒ほど残ることがあります${age}。`;
  }
  return msg;
}

export type WriteLock = {
  ok: true;
  /** 長い操作の途中で `at` を更新する（token はそのまま） */
  refresh(): Promise<void>;
  /** token が一致するときだけ消す */
  release(): Promise<void>;
};
export type WriteLockResult = WriteLock | { ok: false; message: string };

export const BUSY_MESSAGE = "BUSY: 別の MCP の書き換えが進行中です。少し待ってからもう一度お試しください。";

type LockBody = { pid: number; token: string; at: string };

/** MCP どうしの排他ロックを取る（`open(path, "wx")`。死んだ pid か古い at は rename で奪う） */
export async function acquireWriteLock(root: string, deps: GuardDeps = {}): Promise<WriteLockResult> {
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const now = deps.now ?? Date.now;
  const path = appdataPath(root, LOCK_FILE);
  await mkdir(join(root, "appdata"), { recursive: true });

  const token = randomUUID();
  const body = (): LockBody => ({ pid: process.pid, token, at: new Date(now()).toISOString() });

  const makeLock = (): WriteLock => ({
    ok: true,
    async refresh() {
      const cur = (await readJson(path)) as Partial<LockBody> | null;
      if (!cur || cur.token !== token) return; // 奪われていたら触らない
      await writeJsonAtomic(path, body());
    },
    async release() {
      const cur = (await readJson(path)) as Partial<LockBody> | null;
      if (cur && cur.token === token) await rm(path, { force: true }).catch(() => undefined);
    },
  });

  try {
    const fh = await open(path, "wx");
    try {
      await fh.writeFile(JSON.stringify(body()), "utf8");
    } finally {
      await fh.close();
    }
    return makeLock();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }

  // 既にある: 持ち主が死んでいるか古ければ奪う。
  // open 直後で中身が空（書きかけ）・壊れているロックは、少し待って読み直す
  let cur = (await readJson(path)) as Partial<LockBody> | null;
  for (let i = 0; i < 3 && (!cur || typeof cur !== "object"); i++) {
    await new Promise((r) => setTimeout(r, 50));
    cur = (await readJson(path)) as Partial<LockBody> | null;
  }
  const atMs = cur ? parseAt(cur.at) : null;
  const stale = atMs === null || (now() - atMs) / 1000 > LOCK_STALE_SEC;
  const dead = typeof cur?.pid === "number" && !isPidAlive(cur.pid);
  // 読めない（壊れた）ロックも古いものとして扱う
  if (cur && !stale && !dead) return { ok: false, message: BUSY_MESSAGE };

  try {
    await writeJsonAtomic(path, body());
  } catch {
    return { ok: false, message: BUSY_MESSAGE };
  }
  // 同時に奪い合った相手に上書きされていないか確かめる
  const after = (await readJson(path)) as Partial<LockBody> | null;
  if (!after || after.token !== token) return { ok: false, message: BUSY_MESSAGE };
  return makeLock();
}
