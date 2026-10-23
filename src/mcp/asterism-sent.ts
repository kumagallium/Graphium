// 「Asterism に送った」台帳（appdata/asterism-sent.json）。mark_asterism_sent と
// export_asterism_claims の onlyUnsent が使う。root を引数で受ける。

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./upkeep/atomic-write";
import { acquireWriteLock } from "./upkeep/guard";
import { appDataDir, resolveGraphiumRoot } from "./vault";

export type AsterismSentEntry = {
  datasetId: string;
  sentAt: string;
  exportedAt: string | null;
};

export type AsterismSentLedger = {
  version: 1;
  sent: Record<string, AsterismSentEntry>;
};

export function sentLedgerPath(root = resolveGraphiumRoot()): string {
  return join(appDataDir(root), "asterism-sent.json");
}

/** 台帳が読めない・形が違うときの例外（黙って空にしない） */
export class SentLedgerCorruptError extends Error {
  constructor(
    public readonly path: string,
    reason: string,
  ) {
    super(`台帳が壊れています: ${path}。直すか退避してからもう一度お試しください（${reason}）`);
    this.name = "SentLedgerCorruptError";
  }
}

/** 台帳を読む。無ければ空の台帳。壊れていれば SentLedgerCorruptError */
export function readSentLedger(root = resolveGraphiumRoot()): AsterismSentLedger {
  const path = sentLedgerPath(root);
  if (!existsSync(path)) return { version: 1, sent: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new SentLedgerCorruptError(path, `JSON を読めません: ${e instanceof Error ? e.message : String(e)}`);
  }
  const r = raw as { version?: unknown; sent?: unknown } | null;
  if (!r || typeof r !== "object") throw new SentLedgerCorruptError(path, "オブジェクトではありません");
  if (r.version !== 1) throw new SentLedgerCorruptError(path, `version が 1 ではありません: ${String(r.version)}`);
  if (!r.sent || typeof r.sent !== "object" || Array.isArray(r.sent)) {
    throw new SentLedgerCorruptError(path, "sent がオブジェクトではありません");
  }
  return { version: 1, sent: r.sent as Record<string, AsterismSentEntry> };
}

export async function writeSentLedger(ledger: AsterismSentLedger, root = resolveGraphiumRoot()): Promise<void> {
  await writeFileAtomic(sentLedgerPath(root), JSON.stringify(ledger, null, 2));
}

// 同一プロセス内の呼び出しを直列にする（writeFileAtomic の一時ファイル名が pid 単位で衝突するため）
let queue: Promise<unknown> = Promise.resolve();

/**
 * ids を台帳に記録する。記録済みの id は上書きせず alreadySent に数える。
 * MCP どうしの排他ロック（mcp-write-lock.json）を取って 読み→書き する。
 * アプリ起動中の拒否（withWriteGuard）はかけない: 台帳はアプリが読み書きしないファイル
 */
export function markAsterismSent(
  input: { ids: string[]; datasetId: string; exportedAt?: string },
  sentAt: string,
  root = resolveGraphiumRoot(),
): Promise<{ marked: number; alreadySent: number; ledger: string }> {
  const run = queue.then(() => markLocked(input, sentAt, root));
  queue = run.catch(() => undefined);
  return run;
}

async function markLocked(
  input: { ids: string[]; datasetId: string; exportedAt?: string },
  sentAt: string,
  root = resolveGraphiumRoot(),
): Promise<{ marked: number; alreadySent: number; ledger: string }> {
  const lock = await acquireWriteLock(root);
  if (!lock.ok) throw new Error(lock.message);
  try {
    return await markUnderLock(input, sentAt, root);
  } finally {
    await lock.release().catch(() => undefined);
  }
}

async function markUnderLock(
  input: { ids: string[]; datasetId: string; exportedAt?: string },
  sentAt: string,
  root: string,
): Promise<{ marked: number; alreadySent: number; ledger: string }> {
  const ledger = readSentLedger(root);
  let marked = 0;
  let alreadySent = 0;
  for (const id of new Set(input.ids)) {
    if (Object.prototype.hasOwnProperty.call(ledger.sent, id)) {
      alreadySent++;
      continue;
    }
    ledger.sent[id] = { datasetId: input.datasetId, sentAt, exportedAt: input.exportedAt ?? null };
    marked++;
  }
  if (marked > 0) await writeSentLedger(ledger, root);
  return { marked, alreadySent, ledger: sentLedgerPath(root) };
}
