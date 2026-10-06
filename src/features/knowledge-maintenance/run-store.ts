// 保守の記録の読み書き（MaintenanceStorage 経由）

import {
  MAINTENANCE_KEY_PREFIX,
  MAINTENANCE_OPERATION_KINDS,
  MAINTENANCE_PURGE_MAX_PER_RUN,
  MAINTENANCE_RETENTION_DAYS,
  MAINTENANCE_RUN_KEY_PREFIX,
  type MaintenanceOperation,
  type MaintenancePageCopyFile,
  type MaintenanceRun,
  type MaintenanceStorage,
} from "./types";
import { isExpired, isValidWikiId, parseMaintenanceKey } from "./run-format";

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** pages / flags / related の要素の形を確かめる。満たさなければ false（その実行を読めない扱いにする） */
function hasValidOperationParts(op: Record<string, unknown>, runKey: string): boolean {
  const isWikiRef = (v: unknown): v is Record<string, unknown> =>
    isObject(v) && typeof v.wikiId === "string";
  if (!(op.related as unknown[]).every(isWikiRef)) return false;
  const pagesOk = (op.pages as unknown[]).every((p) => {
    if (!isWikiRef(p) || typeof p.copyKey !== "string") return false;
    const parsed = parseMaintenanceKey(p.copyKey);
    // 写しのキーは copy として解釈でき、その実行のものであること
    return parsed?.kind === "copy" && parsed.runKey === runKey;
  });
  if (!pagesOk) return false;
  const flagsOk = (op.flags as unknown[]).every(
    (f) => isWikiRef(f) && (f.flag === "deletedAt" || f.flag === "archivedAt"),
  );
  if (!flagsOk) return false;
  // 取り消しの対象と結果。形が違うと状態の導出で例外になるので、ここで弾く
  if (op.undoOf !== undefined) {
    const u = op.undoOf;
    if (!isObject(u) || typeof u.runId !== "string" || typeof u.operationId !== "string") return false;
  }
  if (op.undoResult !== undefined) {
    const r = op.undoResult;
    if (!isObject(r) || !Array.isArray(r.pages) || !Array.isArray(r.flags)) return false;
    if (![...r.pages, ...r.flags].every((x) => isObject(x))) return false;
  }
  return true;
}

/** 実行のメタを書く（キーは run.id） */
export async function saveRunMeta(storage: MaintenanceStorage, run: MaintenanceRun): Promise<void> {
  await storage.writeAppData(run.id, run);
}

/** 壊れている・formatVersion が違う・キーと id が合わないものは null */
export async function loadRun(storage: MaintenanceStorage, key: string): Promise<MaintenanceRun | null> {
  if (parseMaintenanceKey(key)?.kind !== "run") return null;
  let raw: unknown;
  try {
    raw = await storage.readAppData(key);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.formatVersion !== 1 || raw.id !== key) return null;
  if (!Array.isArray(raw.operations) || typeof raw.startedAt !== "string") return null;
  if (typeof raw.trigger !== "string" || !isObject(raw.actor)) return null;
  const ops = raw.operations as unknown[];
  const known: MaintenanceOperation[] = [];
  for (const op of ops) {
    if (
      !isObject(op) ||
      typeof op.id !== "string" ||
      typeof op.kind !== "string" ||
      typeof op.startedAt !== "string" ||
      !Array.isArray(op.related) ||
      !Array.isArray(op.pages) ||
      !Array.isArray(op.flags)
    ) {
      return null;
    }
    // 未知の kind の操作は、実行を読めない扱いにせず、その操作だけ除く（表示・取り消しの対象から外す）
    if (!(MAINTENANCE_OPERATION_KINDS as readonly string[]).includes(op.kind)) continue;
    if (!hasValidOperationParts(op, key)) return null;
    known.push(op as unknown as MaintenanceOperation);
  }
  return { ...(raw as unknown as MaintenanceRun), operations: known };
}

/** 写しは一度書いたら変えない（呼び出し側の約束）。キーは makeCopyKey の形 */
export async function writePageCopy(
  storage: MaintenanceStorage,
  copyKey: string,
  file: MaintenancePageCopyFile,
): Promise<void> {
  if (parseMaintenanceKey(copyKey)?.kind !== "copy") {
    throw new Error(`invalid maintenance copy key: ${copyKey}`);
  }
  await storage.writeAppData(copyKey, file);
}

export async function loadPageCopy(
  storage: MaintenanceStorage,
  copyKey: string,
): Promise<MaintenancePageCopyFile | null> {
  if (parseMaintenanceKey(copyKey)?.kind !== "copy") return null;
  let raw: unknown;
  try {
    raw = await storage.readAppData(copyKey);
  } catch {
    return null;
  }
  if (!isObject(raw) || raw.formatVersion !== 1) return null;
  // wikiId は新しい appData API のキー規則と同じ形、doc は最低限 title と pages を持つこと
  if (!isValidWikiId(raw.wikiId) || !isObject(raw.doc)) return null;
  if (!Array.isArray(raw.doc.pages) || typeof raw.doc.title !== "string") return null;
  return raw as unknown as MaintenancePageCopyFile;
}

export async function deletePageCopy(storage: MaintenanceStorage, copyKey: string): Promise<void> {
  if (parseMaintenanceKey(copyKey)?.kind !== "copy") return;
  await storage.deleteAppData(copyKey);
}

export async function deleteRun(storage: MaintenanceStorage, runKey: string): Promise<void> {
  if (parseMaintenanceKey(runKey)?.kind !== "run") return;
  await storage.deleteAppData(runKey);
}

/** 実行のキーを新しい順に。厳密に合うものだけ */
export async function listRunKeys(storage: MaintenanceStorage): Promise<string[]> {
  const keys = await storage.listAppDataKeys(MAINTENANCE_RUN_KEY_PREFIX);
  return keys
    .filter((k) => parseMaintenanceKey(k)?.kind === "run")
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

async function loadMany(
  storage: MaintenanceStorage,
  keys: string[],
): Promise<{ runs: MaintenanceRun[]; unreadable: string[] }> {
  const loaded = await Promise.all(keys.map((k) => loadRun(storage, k)));
  const runs: MaintenanceRun[] = [];
  const unreadable: string[] = [];
  loaded.forEach((r, i) => {
    if (r) runs.push(r);
    else unreadable.push(keys[i]);
  });
  return { runs, unreadable };
}

/**
 * 新しい順に limit 件ぶんの実行を読む。beforeKey を渡すとそれより古いものだけ。
 * 読めない実行は飛ばし、そのキーを unreadable に返す。limit には読めない実行も数える。
 */
export async function loadRecentRuns(
  storage: MaintenanceStorage,
  opts: { limit: number; beforeKey?: string },
): Promise<{ runs: MaintenanceRun[]; unreadable: string[]; hasMore: boolean }> {
  let keys = await listRunKeys(storage);
  if (opts.beforeKey) keys = keys.filter((k) => k < opts.beforeKey!);
  const page = keys.slice(0, opts.limit);
  const { runs, unreadable } = await loadMany(storage, page);
  return { runs, unreadable, hasMore: keys.length > page.length };
}

/** 1 回の実行が続き得る最長の目安。これより前に始まった実行は、fromKey の実行と重ならないとみなす */
export const MAINTENANCE_MAX_RUN_MS = 6 * 60 * 60 * 1000;

/**
 * fromKey 以降（fromKey を含む）の全実行を新しい順に。取り消しの再判定用。
 * 実行のキーは開始時刻なので、fromKey より前に始まって重なっている長い実行
 * （そのぶん新しい操作を持ち得る）も、maxOverlapMs 以内なら読む。
 */
export async function loadRunsFrom(
  storage: MaintenanceStorage,
  fromKey: string,
  maxOverlapMs: number = MAINTENANCE_MAX_RUN_MS,
): Promise<{ runs: MaintenanceRun[]; unreadable: string[] }> {
  const from = parseMaintenanceKey(fromKey);
  const lowerMs = from ? from.date.getTime() - maxOverlapMs : null;
  const keys = (await listRunKeys(storage)).filter((k) => {
    if (k >= fromKey) return true;
    if (lowerMs === null) return false;
    const p = parseMaintenanceKey(k);
    return !!p && p.date.getTime() >= lowerMs;
  });
  return loadMany(storage, keys);
}

export type PurgeResult = {
  deleted: number;
  /** 厳密な形に合わず、消さずに残したキー */
  unparseable: string[];
  /** 端末の時計が戻っていると見て何も消さなかったか */
  skippedForClock: boolean;
  /** 1 回あたりの上限（MAINTENANCE_PURGE_MAX_PER_RUN）で打ち切ったか。残りは次の起動で消える */
  capped: boolean;
};

/**
 * 期限切れの掃除。
 * - 厳密に合うキーだけを見る。合わないキーは消さない
 * - いちばん新しいキーの日時が now より 1 日以上先なら、時計が戻っているとみなして何も消さない
 * - 消すのは古い順に最大 MAINTENANCE_PURGE_MAX_PER_RUN キー。時計が大きく進んでいても、
 *   1 回の起動で全部は消えない（残りは次の起動で消える）
 * - 個々の削除の失敗は握って先へ進む（冪等なので次回やり直せる）
 */
export async function purgeExpired(
  storage: MaintenanceStorage,
  now: Date,
  retentionDays: number = MAINTENANCE_RETENTION_DAYS,
): Promise<PurgeResult> {
  const keys = await storage.listAppDataKeys(MAINTENANCE_KEY_PREFIX);
  const parsed: { key: string; p: NonNullable<ReturnType<typeof parseMaintenanceKey>> }[] = [];
  const unparseable: string[] = [];
  for (const key of keys) {
    const p = parseMaintenanceKey(key);
    if (p) parsed.push({ key, p });
    else unparseable.push(key);
  }
  if (unparseable.length > 0) {
    console.warn("[knowledge-maintenance] 読めない名前のキーは消さずに残します:", unparseable);
  }
  const newest = parsed.reduce((m, x) => Math.max(m, x.p.date.getTime()), -Infinity);
  if (newest - now.getTime() >= 86_400_000) {
    return { deleted: 0, unparseable, skippedForClock: true, capped: false };
  }
  // 期限切れを古い順に並べ、上限までだけ消す
  const expired = parsed
    .filter(({ p }) => isExpired(p, now, retentionDays))
    .sort((a, b) => a.p.date.getTime() - b.p.date.getTime() || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const capped = expired.length > MAINTENANCE_PURGE_MAX_PER_RUN;
  let deleted = 0;
  for (const { key } of expired.slice(0, MAINTENANCE_PURGE_MAX_PER_RUN)) {
    try {
      await storage.deleteAppData(key);
      deleted += 1;
    } catch (e) {
      console.warn("[knowledge-maintenance] 期限切れの削除に失敗:", key, e);
    }
  }
  return { deleted, unparseable, skippedForClock: false, capped };
}
