// 保守の記録の純関数（キー・期限・比較・状態の導出・妨げる操作の検出）
// StorageProvider・React・features/wiki には依存しない（段 3 で MCP から再利用する）

import type { GraphiumDocument } from "../../lib/document-types";
import {
  MAINTENANCE_COPY_KEY_PREFIX,
  MAINTENANCE_RUN_KEY_PREFIX,
  type MaintenanceDocCopy,
  type MaintenanceOperation,
  type MaintenanceOperationState,
  type MaintenanceRun,
} from "./types";

// ---------------------------------------------------------------------------
// キー
// ---------------------------------------------------------------------------

const TS = "(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z";
const UUID = "([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})";
const RUN_KEY_RE = new RegExp(`^${MAINTENANCE_RUN_KEY_PREFIX}${TS}-${UUID}$`);
const COPY_KEY_RE = new RegExp(`^${MAINTENANCE_COPY_KEY_PREFIX}${TS}-${UUID}-(\\d{1,6})$`);

export type ParsedMaintenanceKey = {
  kind: "run" | "copy";
  /** キーの日時（UTC） */
  date: Date;
  /** キー中の日時文字列（YYYYMMDDTHHMMSSZ） */
  timestamp: string;
  uuid: string;
  /** copy のときだけ */
  seq?: number;
  /** 属する実行のキー（run ならキー自身） */
  runKey: string;
};

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/** UTC の YYYYMMDDTHHMMSSZ */
export function formatKeyTimestamp(date: Date): string {
  return (
    `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1, 2)}${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}${pad(date.getUTCMinutes(), 2)}${pad(date.getUTCSeconds(), 2)}Z`
  );
}

export function makeRunKey(date: Date, uuid: string): string {
  return `${MAINTENANCE_RUN_KEY_PREFIX}${formatKeyTimestamp(date)}-${uuid}`;
}

/** 実行のキーから写しのキーを作る。runKey が厳密な形でなければ例外 */
export function makeCopyKey(runKey: string, seq: number): string {
  if (!RUN_KEY_RE.test(runKey)) throw new Error(`invalid maintenance run key: ${runKey}`);
  if (!Number.isInteger(seq) || seq < 0 || seq > 999999) {
    throw new Error(`invalid copy sequence: ${seq}`);
  }
  return `${MAINTENANCE_COPY_KEY_PREFIX}${runKey.slice(MAINTENANCE_RUN_KEY_PREFIX.length)}-${seq}`;
}

/** 厳密な形のキーだけ解釈する。合わなければ null */
export function parseMaintenanceKey(key: string): ParsedMaintenanceKey | null {
  const isRun = key.startsWith(MAINTENANCE_RUN_KEY_PREFIX);
  const m = (isRun ? RUN_KEY_RE : COPY_KEY_RE).exec(key);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // 13 月や 32 日などは Date が繰り上げるので、往復で確かめる
  const timestamp = key.slice(isRun ? MAINTENANCE_RUN_KEY_PREFIX.length : MAINTENANCE_COPY_KEY_PREFIX.length).slice(0, 16);
  if (Number.isNaN(date.getTime()) || formatKeyTimestamp(date) !== timestamp) return null;
  const uuid = m[7];
  if (isRun) {
    return { kind: "run", date, timestamp, uuid, runKey: key };
  }
  const runKey = `${MAINTENANCE_RUN_KEY_PREFIX}${timestamp}-${uuid}`;
  return { kind: "copy", date, timestamp, uuid, seq: Number(m[8]), runKey };
}

/** Wiki の id として受け付ける形（新しい appData API のキー規則と同じ） */
const WIKI_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
export function isValidWikiId(id: unknown): id is string {
  return typeof id === "string" && WIKI_ID_RE.test(id);
}

/** キーの日時が retentionDays 日より前なら期限切れ（ちょうど境界は残す） */
export function isExpired(parsed: ParsedMaintenanceKey, now: Date, retentionDays: number): boolean {
  return now.getTime() - parsed.date.getTime() > retentionDays * 86_400_000;
}

// ---------------------------------------------------------------------------
// 内容の写しと比較
// ---------------------------------------------------------------------------

/** 写しに入れる形（documentProvenance を除く） */
export function toDocCopy(doc: GraphiumDocument): MaintenanceDocCopy {
  const { documentProvenance: _omit, ...rest } = doc;
  void _omit;
  return rest;
}

/** キー順をそろえ、undefined の項目を無いものとして扱った JSON */
export function canonicalize(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).sort()) {
    if (obj[k] === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  }
  return `{${parts.join(",")}}`;
}

/** documentProvenance と modifiedAt を除いた全体が同じか */
export function sameContent(
  a: GraphiumDocument | MaintenanceDocCopy,
  b: GraphiumDocument | MaintenanceDocCopy,
): boolean {
  const strip = (d: GraphiumDocument | MaintenanceDocCopy) => {
    const { documentProvenance: _p, modifiedAt: _m, ...rest } = d as GraphiumDocument;
    void _p;
    void _m;
    return rest;
  };
  return canonicalize(strip(a)) === canonicalize(strip(b));
}

// ---------------------------------------------------------------------------
// 状態の導出
// ---------------------------------------------------------------------------

export function operationKey(runId: string, operationId: string): string {
  return `${runId}\u0000${operationId}`;
}

export type OperationStateInfo = {
  state: MaintenanceOperationState;
  /** 有効な取り消しがあるとき、その undo 操作（最新） */
  undoneBy?: { runId: string; operationId: string };
};

type FlatOp = { runId: string; op: MaintenanceOperation; order: number; at: number; idx: number };

/**
 * 操作の新旧を決める時刻（ms）。最初に書き換えた時刻（firstWriteAt）を優先し、無ければ startedAt。
 * begin が先でも書き込みが後の操作は、あとから begin して先に書いた操作より新しい
 */
export function operationOrderTime(op: MaintenanceOperation): number {
  const at = Date.parse(op.firstWriteAt ?? op.startedAt);
  return Number.isNaN(at) ? 0 : at;
}

function flatten(runs: MaintenanceRun[]): FlatOp[] {
  const flat: FlatOp[] = [];
  for (const run of runs) {
    run.operations.forEach((op, idx) => {
      const at = operationOrderTime(op);
      flat.push({ runId: run.id, op, order: 0, at, idx });
    });
  }
  flat.sort((a, b) => a.at - b.at || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0) || a.idx - b.idx);
  flat.forEach((f, i) => {
    f.order = i;
  });
  return flat;
}

/**
 * 各操作の状態を導く（保存しない）。キーは operationKey(runId, operationId)。
 * - 有効な取り消し = undoOf が指していて、完了していて、それ自身が取り消されていない undo 操作
 * - 有効な取り消しが複数あれば最新で判定
 */
export function deriveOperationStates(
  runs: MaintenanceRun[],
  activeRunIds: ReadonlySet<string>,
): Map<string, OperationStateInfo> {
  const flat = flatten(runs);
  const undoers = new Map<string, FlatOp[]>();
  for (const f of flat) {
    if (f.op.kind !== "undo" || !f.op.undoOf || f.op.status !== "applied") continue;
    const k = operationKey(f.op.undoOf.runId, f.op.undoOf.operationId);
    const list = undoers.get(k);
    if (list) list.push(f);
    else undoers.set(k, [f]);
  }

  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const isEffective = (f: FlatOp): boolean => {
    const k = operationKey(f.runId, f.op.id);
    const cached = memo.get(k);
    if (cached !== undefined) return cached;
    if (visiting.has(k)) return false; // 循環は無効扱い
    visiting.add(k);
    const result = !(undoers.get(k) ?? []).some(isEffective);
    visiting.delete(k);
    memo.set(k, result);
    return result;
  };

  const out = new Map<string, OperationStateInfo>();
  for (const f of flat) {
    const k = operationKey(f.runId, f.op.id);
    const effective = (undoers.get(k) ?? []).filter(isEffective);
    if (effective.length > 0) {
      const latest = effective[effective.length - 1]; // flat は古い順
      const r = latest.op.undoResult;
      const allOk =
        !r ||
        ((Array.isArray(r.pages) ? r.pages : []).every((p) => p?.ok) &&
          (Array.isArray(r.flags) ? r.flags : []).every((x) => x?.ok));
      out.set(k, {
        state: allOk ? "undone" : "undo_partial",
        undoneBy: { runId: latest.runId, operationId: latest.op.id },
      });
    } else if (f.op.status === "running") {
      out.set(k, { state: activeRunIds.has(f.runId) ? "running" : "interrupted" });
    } else {
      out.set(k, { state: "applied" });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 取り消しを妨げる操作
// ---------------------------------------------------------------------------

export type BlockingOperation = { runId: string; operationId: string; op: MaintenanceOperation };

/** pages / flags / related に触れている wikiId。読み込んだ記録が想定外の形でも例外にしない */
function touchedWikiIds(op: MaintenanceOperation): Set<string> {
  const ids = new Set<string>();
  for (const list of [op.pages, op.flags, op.related]) {
    if (!Array.isArray(list)) continue;
    for (const item of list as unknown[]) {
      const id = (item as { wikiId?: unknown } | null | undefined)?.wikiId;
      if (typeof id === "string") ids.add(id);
    }
  }
  return ids;
}

/**
 * target より新しく、取り消されておらず、同じ wikiId を pages / flags / related に持つ操作。
 * - undo 操作も対象。一部だけ取り消された操作（undo_partial）も、まだ効いているので妨げる
 * - 自分自身は含めない
 * - target の取り消しの鎖（target を取り消した undo、その undo を取り消した undo …）は
 *   target 自身の履歴なので含めない（取り消しの取り消しのあとに再取り消しできるように）
 */
export function findBlockingOperations(
  runs: MaintenanceRun[],
  target: { runId: string; operationId: string },
  activeRunIds: ReadonlySet<string> = new Set(),
): BlockingOperation[] {
  const flat = flatten(runs);
  const targetKey = operationKey(target.runId, target.operationId);
  const t = flat.find((f) => operationKey(f.runId, f.op.id) === targetKey);
  if (!t) return [];

  const chain = new Set<string>([targetKey]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of flat) {
      const k = operationKey(f.runId, f.op.id);
      if (chain.has(k) || f.op.kind !== "undo" || !f.op.undoOf) continue;
      if (chain.has(operationKey(f.op.undoOf.runId, f.op.undoOf.operationId))) {
        chain.add(k);
        grew = true;
      }
    }
  }

  const ids = touchedWikiIds(t.op);
  const states = deriveOperationStates(runs, activeRunIds);
  const blocking: BlockingOperation[] = [];
  for (const f of flat) {
    if (f.order <= t.order) continue;
    const k = operationKey(f.runId, f.op.id);
    if (chain.has(k)) continue;
    if (states.get(k)?.state === "undone") continue;
    // target より新しい操作を取り消し済みにした undo は、その操作と打ち消し合っているので妨げない
    // （新しい順に巻き戻す導線を成立させる）
    if (f.op.kind === "undo" && f.op.undoOf && f.op.status === "applied") {
      const uk = operationKey(f.op.undoOf.runId, f.op.undoOf.operationId);
      const us = states.get(uk);
      const undoneOp = flat.find((x) => operationKey(x.runId, x.op.id) === uk);
      if (
        us?.state === "undone" &&
        us.undoneBy?.runId === f.runId &&
        us.undoneBy.operationId === f.op.id &&
        undoneOp &&
        undoneOp.order > t.order
      ) {
        continue;
      }
    }
    const touched = touchedWikiIds(f.op);
    for (const id of ids) {
      if (touched.has(id)) {
        blocking.push({ runId: f.runId, operationId: f.op.id, op: f.op });
        break;
      }
    }
  }
  return blocking;
}

/**
 * target の取り消しの鎖。target 自身と、target を取り消した undo、その undo を取り消した undo …を
 * 古い順に返す（target が先頭）。取り消しの取り消しのあとの再取り消しで、
 * フラグの「いまあるべき値」を鎖の最新から導くのに使う。
 */
export function collectUndoChain(
  runs: MaintenanceRun[],
  target: { runId: string; operationId: string },
): { runId: string; op: MaintenanceOperation }[] {
  const flat = flatten(runs);
  const targetKey = operationKey(target.runId, target.operationId);
  if (!flat.some((f) => operationKey(f.runId, f.op.id) === targetKey)) return [];
  const chain = new Set<string>([targetKey]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of flat) {
      const k = operationKey(f.runId, f.op.id);
      if (chain.has(k) || f.op.kind !== "undo" || !f.op.undoOf) continue;
      if (chain.has(operationKey(f.op.undoOf.runId, f.op.undoOf.operationId))) {
        chain.add(k);
        grew = true;
      }
    }
  }
  return flat
    .filter((f) => chain.has(operationKey(f.runId, f.op.id)))
    .map((f) => ({ runId: f.runId, op: f.op }));
}
