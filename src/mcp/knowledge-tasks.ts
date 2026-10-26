// 外の AI に配った課題の台帳（appdata/mcp-knowledge-tasks.json）。
// start_claim_task が課題を足し、submit_claims / submit_rewrite が照合して done にする。
// 設計: docs/internal/mcp-knowledge-generation-design-2026-10.md §4 / §10
//
// 書き込みは asterism-sent.ts と同じ型: プロセス内 queue で直列にし、writeFileAtomic で原子的に書く。
// ほかの MCP プロセスとの排他は acquireWriteLock（書き換え系の呼び出し元がすでに持っているときは取り直さない）。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./upkeep/atomic-write";
import { acquireWriteLock } from "./upkeep/guard";
import { appDataDir } from "./vault";

/** 課題の期限（ミリ秒）。過ぎた課題は TASK_EXPIRED */
export const TASK_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * 期限が過ぎた課題を台帳に残す猶予（ミリ秒）。すぐ消すと提出が TASK_NOT_FOUND になり、
 * 「期限切れ」と「そもそも配っていない」を区別できなくなる。猶予を過ぎたものは次の書き込みで掃除する
 */
export const TASK_PURGE_GRACE_MS = 24 * 60 * 60 * 1000;

export type KnowledgeTaskKind = "claims" | "rewrite";

export type KnowledgeTask = {
  taskId: string;
  kind: KnowledgeTaskKind;
  /** 知見の派生元ノート（claims）／書き足したときの派生元ノート（rewrite） */
  noteId: string;
  /** claims: 課題を配ったときのノート（タイトル＋本文）のハッシュ。変わっていたら TASK_STALE */
  inputHash: string;
  /**
   * claims: 配った既存の知見一覧の番号 → id。parseIngesterOutput が c12 などを id に戻すのに要る最小限。
   * ここに無い id は通さない（配っていない id を名乗らせない）
   */
  existingIndex?: {
    refToId: Record<string, string>;
    shown: number;
    omitted: number;
    /** 次に振る c 番号（find_claims_for_task が続きから振る。アプリの一覧の番号は 1 から全件に振られる） */
    nextRef?: number;
    /** 有効な知見の総数（課題を配った時点） */
    totalClaims?: number;
  };
  language: string;
  /** URL 素材の課題だけ: 配ったときの本文の控え（提出の原文照合に使う。取り直さない） */
  sourceSnapshot?: { noteTitle: string; noteContent: string; sourceTitle: string };
  /** 配ったときに適用した Skill の名前（知見の skillsUsed に残す） */
  skillsUsed?: string[];
  client?: string;
  createdAt: string;
  doneAt?: string;
  /** rewrite: 清書する知見のページ id */
  wikiId?: string;
  /** rewrite: 書き足し後のページの内容ハッシュ。変わっていたら TASK_STALE */
  contentHash?: string;
};

export type KnowledgeTaskLedger = { version: 1; tasks: Record<string, KnowledgeTask> };

export function tasksLedgerPath(root: string): string {
  return join(appDataDir(root), "mcp-knowledge-tasks.json");
}

/** 台帳が読めない・形が違うときの例外（黙って空にしない） */
export class TaskLedgerCorruptError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`LEDGER_CORRUPT: 課題の台帳が壊れています: ${path}。直すか退避してからもう一度お試しください（${reason}）`);
    this.name = "TaskLedgerCorruptError";
  }
}

/** 台帳を読む。無ければ空。壊れていれば TaskLedgerCorruptError */
export function readTaskLedger(root: string): KnowledgeTaskLedger {
  const path = tasksLedgerPath(root);
  if (!existsSync(path)) return { version: 1, tasks: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new TaskLedgerCorruptError(path, `JSON を読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
  const r = raw as { version?: unknown; tasks?: unknown } | null;
  if (!r || typeof r !== "object") throw new TaskLedgerCorruptError(path, "オブジェクトではありません");
  if (r.version !== 1) throw new TaskLedgerCorruptError(path, `version が 1 ではありません: ${String(r.version)}`);
  if (!r.tasks || typeof r.tasks !== "object" || Array.isArray(r.tasks)) {
    throw new TaskLedgerCorruptError(path, "tasks がオブジェクトではありません");
  }
  return { version: 1, tasks: r.tasks as Record<string, KnowledgeTask> };
}

export type TaskLookup =
  | { ok: true; task: KnowledgeTask }
  | { ok: false; code: "TASK_NOT_FOUND" | "TASK_EXPIRED" | "TASK_DONE" };

/** 提出時の照合。期限は createdAt + 24 時間。done と期限切れは別の理由で断る */
export function lookupTask(
  root: string,
  taskId: string,
  now: Date = new Date(),
): TaskLookup {
  const tasks = readTaskLedger(root).tasks;
  const task = Object.prototype.hasOwnProperty.call(tasks, taskId) ? tasks[taskId] : undefined;
  if (!task) return { ok: false, code: "TASK_NOT_FOUND" };
  if (task.doneAt) return { ok: false, code: "TASK_DONE" };
  if (isExpired(task, now)) return { ok: false, code: "TASK_EXPIRED" };
  return { ok: true, task };
}

export function taskExpiresAt(task: Pick<KnowledgeTask, "createdAt">): Date {
  return new Date(Date.parse(task.createdAt) + TASK_TTL_MS);
}

export function isExpired(task: Pick<KnowledgeTask, "createdAt">, now: Date): boolean {
  return now.getTime() > Date.parse(task.createdAt) + TASK_TTL_MS;
}

/** 猶予も過ぎた課題を落とす（書き込みのたびに掃除する） */
function sweep(ledger: KnowledgeTaskLedger, now: Date): KnowledgeTaskLedger {
  const tasks: Record<string, KnowledgeTask> = {};
  for (const [id, t] of Object.entries(ledger.tasks)) {
    if (now.getTime() > Date.parse(t.createdAt) + TASK_TTL_MS + TASK_PURGE_GRACE_MS) continue;
    tasks[id] = t;
  }
  return { version: 1, tasks };
}

// 同一プロセス内の書き込みを直列にする（writeFileAtomic の一時ファイル名が pid 単位で衝突するため）
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function mutate(
  root: string,
  fn: (ledger: KnowledgeTaskLedger) => void,
  now: Date,
): Promise<void> {
  const ledger = sweep(readTaskLedger(root), now);
  fn(ledger);
  await writeFileAtomic(tasksLedgerPath(root), JSON.stringify(ledger, null, 2));
}

/**
 * 課題を足す。MCP どうしの排他ロックを取って 読み→書き する（start_claim_task 用）。
 * ロックが取れなければ message を返す。壊れた台帳は TaskLedgerCorruptError を投げる
 */
export function addTask(
  root: string,
  task: KnowledgeTask,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; message: string }> {
  return enqueue(async () => {
    const lock = await acquireWriteLock(root);
    if (!lock.ok) return { ok: false as const, message: lock.message };
    try {
      await mutate(root, (l) => void (l.tasks[task.taskId] = task), now);
      return { ok: true as const };
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
}

/**
 * 台帳の課題を更新する（find_claims_for_task 用）。MCP どうしの排他ロックを取って 読み→書き する。
 * 課題が無い・done・期限切れのときは code を返す。fn が null を返したら書かない
 */
export function updateTask(
  root: string,
  taskId: string,
  fn: (task: KnowledgeTask) => KnowledgeTask | null,
  now: Date = new Date(),
): Promise<
  | { ok: true; task: KnowledgeTask }
  | { ok: false; code: "TASK_NOT_FOUND" | "TASK_EXPIRED" | "TASK_DONE" }
  | { ok: false; message: string }
> {
  return enqueue(async () => {
    const lock = await acquireWriteLock(root);
    if (!lock.ok) return { ok: false as const, message: lock.message };
    try {
      const found = lookupTask(root, taskId, now);
      if (!found.ok) return found;
      const next = fn(found.task);
      if (next) await mutate(root, (l) => void (l.tasks[taskId] = next), now);
      return { ok: true as const, task: next ?? found.task };
    } finally {
      await lock.release().catch(() => undefined);
    }
  });
}

/**
 * 呼び出し元がすでに書き込みロック（withWriteGuard）を持っているときの更新。
 * ロックは取り直さない（取り直すと自分自身の BUSY になる）
 */
export function addTaskHoldingLock(root: string, task: KnowledgeTask, now: Date = new Date()): Promise<void> {
  return enqueue(() => mutate(root, (l) => void (l.tasks[task.taskId] = task), now));
}

/** 課題を done にする（ロックを持っている呼び出し元用）。台帳に無ければ何もしない */
export function markTaskDone(root: string, taskId: string, now: Date = new Date()): Promise<void> {
  return enqueue(() =>
    mutate(
      root,
      (l) => {
        const t = l.tasks[taskId];
        if (t) l.tasks[taskId] = { ...t, doneAt: now.toISOString() };
      },
      now,
    ),
  );
}
