// 共有したノートが「どの共有の計画の、どの行の記録か」を指す対応（封筒の extra.planRow）。
//
// なぜ要るか:
//   計画の行からノートを作ると、行とノートの対応は計画ノートの表の注釈（tableMeta.noteLinks）に
//   手元のノート id で残る。手元の id は人ごとに別の空間なので、学生が共有したノートを先生の
//   計画から見ても、どの行の記録かが分からない。共有するときに、共有の id と行の id で
//   言い直した対応を封筒に添える。
//
// 守っていること:
//   - 持つのは対応だけ（どの計画・どの行）。進み具合・担当・期限のような、更新しないと
//     嘘になる状態は持たない。「誰がいつ記録したか」は記録（共有エントリ）そのものから読む
//   - 手元のノートには新しい項目を足さない。共有のたびに、手元の計画ノートの表から組み直す
//   - 一度付いた対応は、組み直せなかった再共有（計画の写しを消したあと等）でも落とさない
//     （share-note.ts）。外れるのは共有をやめたとき
//   - 共有フォーマットの版は変えない（項目が無いだけ。読む側は optional）

import type { GraphiumDocument } from "../../lib/document-types";
import type { SharedEntry } from "../../lib/storage/shared";
import { findIncomingReferences, type GraphiumIndex } from "../navigation/index-file";
import { collectOperationRows, normalizeOperationName } from "../network-graph/plan-flow";

export type PlanRowRef = {
  /**
   * 計画の共有エントリ id。写しの元（forkedFrom）が先、自分で共有した計画（sharedRef）が後。
   * 写しをさらに自分の計画として共有した人のノートは、両方を持つ
   */
  planIds: string[];
  /** 行のある表のブロック id（共有と写しでは変わらない） */
  tableBlockId: string;
  /** 行の id（先頭セルの tableRowIdentity）。採番前の古い表の行には無い */
  rowId?: string;
  /** 行の名前（先頭の "@" を外したもの）。行の id が無いときの照合と、表示に使う */
  rowName: string;
};

/** その計画ノートを指す共有エントリの id（写しの元 → 自分の共有コピーの順） */
export function planSharedIdsOf(
  doc: Pick<GraphiumDocument, "sharedRef" | "forkedFrom"> | null | undefined,
): string[] {
  const ids: string[] = [];
  const forked = doc?.forkedFrom?.sharedId;
  if (typeof forked === "string" && forked) ids.push(forked);
  const own = doc?.sharedRef;
  if (own && own.type === "note" && typeof own.id === "string" && own.id && !ids.includes(own.id)) {
    ids.push(own.id);
  }
  return ids;
}

/** 表示用の行名（先頭の "@" を外す） */
export function planRowDisplayName(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
}

export type PlanCandidate = { noteId: string; doc: GraphiumDocument };

/**
 * ノートを行に持つ計画を candidates から探し、対応を組む。
 * 共有に出ていない計画（写しでも、自分で共有したものでもない）は対応にならない。
 * 先に渡した候補が勝つ（呼び出し側は、派生元の計画を先頭に置く）。
 */
export function resolvePlanRowRef(
  noteId: string,
  candidates: readonly PlanCandidate[],
): { ref: PlanRowRef; planNoteId: string; planTitle: string } | null {
  for (const { noteId: planNoteId, doc } of candidates) {
    const planIds = planSharedIdsOf(doc);
    if (planIds.length === 0) continue;
    const row = collectOperationRows(doc).find((r) => r.noteId === noteId);
    if (!row) continue;
    return {
      ref: {
        planIds,
        tableBlockId: row.tableBlockId,
        ...(row.rowId ? { rowId: row.rowId } : {}),
        rowName: planRowDisplayName(row.name),
      },
      planNoteId,
      planTitle: doc.title ?? "",
    };
  }
  return null;
}

/** 1 回の共有で開いて確かめる計画ノートの上限（このノートを指しているノートが多いときの歯止め） */
export const PLAN_CANDIDATE_LIMIT = 8;

export type PlanRowLookupDeps = {
  /** ノートの索引（このノートを指しているノートを引く）。無ければ派生元だけを見る */
  index: GraphiumIndex | null;
  /** 保存済みのノートを読む（読めなければ null） */
  loadNote: (id: string) => Promise<GraphiumDocument | null>;
};

/**
 * 共有するノートについて、手元の計画ノートから対応を組む。
 *
 * 見る順は、行から作ったときの派生元（derivedFromNoteId）→ このノートを指しているノート
 * （新しい順）。既存のノートを行に紐付けた場合は派生元が計画ではないので、後者で拾う。
 * 計画ノートかどうか（kind）は問わない。行からノートを作れる表があれば対応は付く。
 * 読めないノートは飛ばす（対応のために共有を失敗させない）。
 */
export async function resolvePlanRowForNote(
  noteId: string,
  doc: Pick<GraphiumDocument, "derivedFromNoteId">,
  deps: PlanRowLookupDeps,
): Promise<{ ref: PlanRowRef; planNoteId: string; planTitle: string } | null> {
  const ids: string[] = [];
  if (doc.derivedFromNoteId) ids.push(doc.derivedFromNoteId);
  const referrers = findIncomingReferences(deps.index, noteId)
    .slice()
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  for (const n of referrers) if (!ids.includes(n.noteId)) ids.push(n.noteId);

  for (const id of ids.slice(0, PLAN_CANDIDATE_LIMIT)) {
    if (id === noteId) continue;
    let planDoc: GraphiumDocument | null = null;
    try {
      planDoc = await deps.loadNote(id);
    } catch {
      planDoc = null;
    }
    if (!planDoc) continue;
    try {
      const found = resolvePlanRowRef(noteId, [{ noteId: id, doc: planDoc }]);
      if (found) return found;
    } catch {
      // 表の形が壊れた計画ノートは飛ばす（対応のために共有を失敗させない）
    }
  }
  return null;
}

/** 封筒から読む planIds の上限（自分で書くのは多くて 2 件。複製の元と自分の共有） */
export const PLAN_IDS_LIMIT = 8;
/** id（共有エントリ・表のブロック・行）として読む長さの上限 */
const ID_MAX_LENGTH = 128;
/** 行の名前として読む長さの上限（超えた分は切る） */
export const ROW_NAME_MAX_LENGTH = 300;

const isIdLike = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= ID_MAX_LENGTH;

/**
 * 形の合う PlanRowRef だけを返す。封筒は他の人が書くので 1 項目ずつ確かめ、大きさにも上限を置く
 * （計画を開くたびに全部の封筒を読むので、巨大な値を置かれても重くならないように）
 */
export function parsePlanRowRef(raw: unknown): PlanRowRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.planIds)) return null;
  const planIds: string[] = [];
  // 先頭の数件だけを見る（長い配列を最後まで走査しない）
  for (const id of r.planIds.slice(0, PLAN_IDS_LIMIT)) {
    if (isIdLike(id) && !planIds.includes(id)) planIds.push(id);
  }
  if (planIds.length === 0) return null;
  if (!isIdLike(r.tableBlockId)) return null;
  if (typeof r.rowName !== "string") return null;
  return {
    planIds,
    tableBlockId: r.tableBlockId,
    ...(isIdLike(r.rowId) ? { rowId: r.rowId } : {}),
    rowName: r.rowName.slice(0, ROW_NAME_MAX_LENGTH),
  };
}

/** 並べ替えに使う更新日時（欠けた・文字列でない封筒は空文字として扱い、落とさない） */
export function entryUpdatedAt(entry: SharedEntry): string {
  return typeof entry.updated_at === "string" ? entry.updated_at : "";
}

/** 共有エントリの封筒から対応を読む。ノート以外・形の合わないものは null */
export function readPlanRowRef(entry: SharedEntry | null | undefined): PlanRowRef | null {
  if (!entry || entry.type !== "note") return null;
  return parsePlanRowRef((entry.extra as Record<string, unknown> | undefined)?.planRow);
}

/** その計画（のどれか）を指している記録の共有エントリ。新しい順 */
export function findPlanRecords(
  planIds: readonly string[],
  entries: readonly SharedEntry[],
): { entry: SharedEntry; ref: PlanRowRef }[] {
  if (planIds.length === 0) return [];
  const wanted = new Set(planIds);
  const out: { entry: SharedEntry; ref: PlanRowRef }[] = [];
  for (const entry of entries) {
    if (entry.status === "unshared") continue;
    // 計画そのものは自分の記録ではない
    if (wanted.has(entry.id)) continue;
    const ref = readPlanRowRef(entry);
    if (!ref || !ref.planIds.some((id) => wanted.has(id))) continue;
    out.push({ entry, ref });
  }
  return out.sort((a, b) => entryUpdatedAt(b.entry).localeCompare(entryUpdatedAt(a.entry)));
}

/** 照合に使う計画の行（plan-flow の OperationRow の一部） */
export type PlanRowKey = { tableBlockId: string; rowId?: string; name: string };

/** 行を一意に指すキー（同じ表の中の位置ではなく、行の id か名前） */
export function planRowKey(row: PlanRowKey): string {
  return row.rowId ? `id:${row.rowId}` : `name:${row.tableBlockId}:${normalizeOperationName(row.name)}`;
}

export type PlanRowRecords = {
  /** planRowKey(行) → その行の記録（新しい順） */
  byRow: Map<string, SharedEntry[]>;
  /** 計画を指しているが、いまの表に合う行が無い記録（行を消した・写しで足した行など） */
  unmatched: { entry: SharedEntry; ref: PlanRowRef }[];
};

/**
 * 計画の行ごとに、共有された記録を振り分ける。
 *
 * 照合は行の id が先。記録の側に行の id が無い、または計画の側でその id の行が見つからない
 * ときは、同じ表の同じ名前（trim・小文字・先頭 "@" を外す）の行に寄せる。
 * どちらでも見つからない記録は unmatched に入れる（黙って消さない）。
 */
export function groupPlanRecordsByRow(
  planIds: readonly string[],
  rows: readonly PlanRowKey[],
  entries: readonly SharedEntry[],
): PlanRowRecords {
  const byRow = new Map<string, SharedEntry[]>();
  const unmatched: { entry: SharedEntry; ref: PlanRowRef }[] = [];
  const records = findPlanRecords(planIds, entries);
  if (records.length === 0) return { byRow, unmatched };

  const byId = new Map<string, PlanRowKey>();
  const byName = new Map<string, PlanRowKey>();
  for (const row of rows) {
    if (row.rowId && !byId.has(row.rowId)) byId.set(row.rowId, row);
    const nameKey = `${row.tableBlockId}:${normalizeOperationName(row.name)}`;
    // 同名の行は先に出た行に寄せる（工程の同名の扱いと同じ）
    if (!byName.has(nameKey)) byName.set(nameKey, row);
  }

  for (const record of records) {
    const { ref } = record;
    const row =
      (ref.rowId ? byId.get(ref.rowId) : undefined) ??
      byName.get(`${ref.tableBlockId}:${normalizeOperationName(ref.rowName)}`);
    if (!row) {
      unmatched.push(record);
      continue;
    }
    const key = planRowKey(row);
    const list = byRow.get(key);
    if (list) list.push(record.entry);
    else byRow.set(key, [record.entry]);
  }
  return { byRow, unmatched };
}
