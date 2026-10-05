// 保守の操作の取り消しと、取り消す前の影響の見積もり
// 仕様: docs/internal/knowledge-maintenance-undo-spec-2026-10.md §5

import { recordRevision } from "../document-provenance";
import type { AuthorIdentity } from "../document-provenance/types";
import { buildRestoredDocument } from "../version-snapshots/snapshot-store";
import type { GraphiumDocument } from "../../lib/document-types";
import { activeRunIds, beginMaintenanceRun, type MaintenanceHost } from "./recorder";
import {
  canonicalize,
  collectUndoChain,
  deriveOperationStates,
  findBlockingOperations,
  operationKey,
  sameContent,
  type BlockingOperation,
} from "./run-format";
import { loadPageCopy, loadRunsFrom } from "./run-store";
import { withPageLock } from "./page-lock";
import {
  asMaintenanceStorage,
  type MaintenanceActor,
  type MaintenanceOperation,
  type MaintenanceOperationState,
  type MaintenancePageCopyFile,
  type MaintenanceRun,
  type MaintenanceStorage,
} from "./types";

export type UndoTarget = { runId: string; operationId: string };

type FlagName = "deletedAt" | "archivedAt";

export type UndoExtras = {
  /** 編集の記録に残す実行者（email / 自己申告の author） */
  getAuthor(): Promise<{ email?: string; author?: AuthorIdentity }>;
  /**
   * 戻したページごとに呼ぶ。検索用の埋め込みの取り直し・開いているメインエディタ／サイドピークの差し替えをここでやる。
   * 失敗しても取り消しは成功のまま（握ってコンソールに出す）
   */
  afterRestore(wikiId: string, doc: GraphiumDocument): Promise<void> | void;
  /** 取り消しの実行者（省略時は { via: "app" }） */
  actor?: MaintenanceActor;
  /** 取り消しが終わったときに 1 回呼ぶ（wiki-log への書き込み用）。失敗しても握る */
  logUndone?: (info: UndoLogInfo) => Promise<void> | void;
};

export type UndoLogInfo = {
  target: UndoTarget;
  undoRunId: string;
  undoOperationId: string;
  subject?: { wikiId: string; title: string };
  restoredPageCount: number;
  failedCount: number;
};

/** 取り消しを断る理由 */
export type UndoRefusal =
  | { code: "unsupported" }
  /** 実行が期限切れで消えている・読めない */
  | { code: "not_found" }
  | { code: "already_undone" }
  /** いま動いている実行の操作、または同じ操作の取り消しがすでに走っている */
  | { code: "in_progress" }
  /** より新しい、まだ有効な操作が同じページに関わっている */
  | { code: "blocked"; blockers: BlockingOperation[] }
  /** 写しのキーが読めない */
  | { code: "copy_unreadable"; copyKeys: string[] };

export type UndoOutcome =
  | { status: "refused"; refusal: UndoRefusal }
  | {
      status: "done";
      undoRunId: string;
      undoOperationId: string;
      /** 実際に書き戻したページ */
      restoredPages: { wikiId: string; title: string }[];
      /** すでに写しと同じ内容で、書かずに成功にしたページ */
      unchangedPages: { wikiId: string; title: string }[];
      failedPages: { wikiId: string; title: string; reason: string }[];
      restoredFlags: { wikiId: string; flag: FlagName }[];
      failedFlags: { wikiId: string; flag: FlagName; reason: string }[];
    };

// ---------------------------------------------------------------------------
// 共通: 対象の判定とフラグの計画
// ---------------------------------------------------------------------------

/** 取り消しが走っている操作（二重起動を断る） */
const inFlight = new Set<string>();

type Evaluated =
  | { ok: false; refusal: UndoRefusal }
  | {
      ok: true;
      run: MaintenanceRun;
      op: MaintenanceOperation;
      state: MaintenanceOperationState;
      /** copyKey → 写し */
      copies: Map<string, MaintenancePageCopyFile>;
    };

async function evaluateTarget(
  storage: MaintenanceStorage,
  runs: MaintenanceRun[],
  target: UndoTarget,
): Promise<Evaluated> {
  const run = runs.find((r) => r.id === target.runId);
  const op = run?.operations.find((o) => o.id === target.operationId);
  if (!run || !op) return { ok: false, refusal: { code: "not_found" } };

  const active = activeRunIds();
  const state =
    deriveOperationStates(runs, active).get(operationKey(run.id, op.id))?.state ?? "applied";
  if (state === "running" || active.has(run.id)) return { ok: false, refusal: { code: "in_progress" } };
  if (state === "undone") return { ok: false, refusal: { code: "already_undone" } };

  const blockers = findBlockingOperations(runs, target, active);
  if (blockers.length > 0) return { ok: false, refusal: { code: "blocked", blockers } };

  const copies = new Map<string, MaintenancePageCopyFile>();
  const missing: string[] = [];
  for (const page of op.pages) {
    const file = await loadPageCopy(storage, page.copyKey);
    if (!file || file.wikiId !== page.wikiId) missing.push(page.copyKey);
    else copies.set(page.copyKey, file);
  }
  if (missing.length > 0) return { ok: false, refusal: { code: "copy_unreadable", copyKeys: missing } };

  return { ok: true, run, op, state, copies };
}

type FlagPlanItem = {
  wikiId: string;
  flag: FlagName;
  /** 操作の前の値（戻す先） */
  before: string | null;
  /** いま索引にあるはずの値（鎖の最新の after）。これと同じときだけ動かす */
  expected: string | null;
  /** 記録が欠けた中断操作から補ったもの */
  inferred: boolean;
};

const FLAGS: FlagName[] = ["deletedAt", "archivedAt"];

/**
 * 戻すフラグの計画（実行する順）。
 * - 同じ (wikiId, flag) は 1 つにまとめる。before は操作の最初の変化の前、expected は
 *   取り消しの鎖（取り消しの取り消しなど）の最新の after
 * - 中断された操作（running）は記録が欠けることがあるので、related のうちいまフラグが立っていて
 *   その時刻が操作の開始以降のものを補う（手順 5）
 */
function planFlags(
  runs: MaintenanceRun[],
  target: UndoTarget,
  op: MaintenanceOperation,
  host: MaintenanceHost,
): FlagPlanItem[] {
  const chain = collectUndoChain(runs, target);
  const recorded: FlagPlanItem[] = [];
  const index = new Map<string, FlagPlanItem>();
  for (const c of op.flags) {
    const k = `${c.wikiId}\u0000${c.flag}`;
    if (index.has(k)) continue;
    let expected = c.after;
    for (const link of chain) {
      for (const f of link.op.flags) {
        if (f.wikiId === c.wikiId && f.flag === c.flag) expected = f.after;
      }
    }
    const item: FlagPlanItem = {
      wikiId: c.wikiId,
      flag: c.flag,
      before: c.before,
      expected,
      inferred: false,
    };
    index.set(k, item);
    recorded.push(item);
  }

  const inferred: FlagPlanItem[] = [];
  if (op.status === "running") {
    const startedAt = Date.parse(op.startedAt);
    for (const r of op.related) {
      const flags = host.getIndexFlags(r.wikiId);
      for (const flag of FLAGS) {
        const v = flags?.[flag];
        if (!v || index.has(`${r.wikiId}\u0000${flag}`)) continue;
        if (!(Date.parse(v) >= startedAt)) continue;
        inferred.push({ wikiId: r.wikiId, flag, before: null, expected: v, inferred: true });
      }
    }
  }
  // 逆順に戻す（補ったものは記録より後に起きたとみなして先に）
  return [...inferred, ...recorded.reverse()];
}

function titleLookup(op: MaintenanceOperation): (wikiId: string) => string {
  return (wikiId) =>
    op.pages.find((p) => p.wikiId === wikiId)?.title ??
    op.related.find((r) => r.wikiId === wikiId)?.title ??
    (op.subject?.wikiId === wikiId ? op.subject.title : "");
}

// ---------------------------------------------------------------------------
// 取り消す前の見積もり
// ---------------------------------------------------------------------------

export type UndoImpact = {
  canUndo: boolean;
  /** 取り消せないときの理由（妨げている操作の名前など） */
  refusal?: UndoRefusal;
  pages: {
    wikiId: string;
    title: string;
    /** 完全削除されていて戻せない */
    deleted: boolean;
    /** すでに写しと同じ内容（戻しても何も変わらない） */
    unchanged: boolean;
    /** 操作のあとの編集の回数（編集の記録のうち savedAt が操作の終了より後のもの） */
    editsAfter: number;
    /** 編集の記録に残らない変更がある（回数が 0 なのに modifiedAt が操作の終了より後） */
    untrackedChange: boolean;
    /** 出典照合・世界照合の結果も戻る（写しと現在で wikiMeta.sourceCheck / grounding が違う） */
    checksAlsoRevert: boolean;
  }[];
  flags: {
    wikiId: string;
    flag: FlagName;
    title: string;
    /** 索引に無い（吸収された側が完全に削除された場合など）ので戻せない */
    restorable: boolean;
  }[];
};

/**
 * 確認の文言に使う見積もり。runs は loadRecentRuns / loadRunsFrom で読んだもの。
 * 判定は undoMaintenanceOperation と同じ（取り消せるか・断る理由）
 */
export async function describeUndoImpact(
  host: MaintenanceHost,
  runs: MaintenanceRun[],
  target: UndoTarget,
): Promise<UndoImpact> {
  const empty = (refusal: UndoRefusal): UndoImpact => ({ canUndo: false, refusal, pages: [], flags: [] });
  const storage = asMaintenanceStorage(host.provider());
  if (!storage) return empty({ code: "unsupported" });
  if (inFlight.has(operationKey(target.runId, target.operationId))) return empty({ code: "in_progress" });

  const ev = await evaluateTarget(storage, runs, target);
  if (!ev.ok) return empty(ev.refusal);
  const { op, copies } = ev;
  const endedAt = op.endedAt ? Date.parse(op.endedAt) : null;

  const pages: UndoImpact["pages"] = [];
  for (const page of op.pages) {
    const copy = copies.get(page.copyKey)!;
    const current = await host.loadWikiDocFresh(page.wikiId);
    if (!current) {
      pages.push({
        wikiId: page.wikiId,
        title: page.title,
        deleted: true,
        unchanged: false,
        editsAfter: 0,
        untrackedChange: false,
        checksAlsoRevert: false,
      });
      continue;
    }
    const unchanged = sameContent(current, copy.doc);
    // 操作の終了時刻が無い（中断された操作）ときは、あとの編集を数えられない
    const editsAfter =
      endedAt === null || unchanged
        ? 0
        : (current.documentProvenance?.revisions ?? []).filter((r) => Date.parse(r.savedAt) > endedAt).length;
    const untrackedChange =
      endedAt !== null &&
      !unchanged &&
      editsAfter === 0 &&
      Date.parse(current.modifiedAt) > endedAt;
    const checkOf = (d: { wikiMeta?: { sourceCheck?: unknown; grounding?: unknown } }) =>
      canonicalize({ sourceCheck: d.wikiMeta?.sourceCheck, grounding: d.wikiMeta?.grounding });
    pages.push({
      wikiId: page.wikiId,
      title: page.title,
      deleted: false,
      unchanged,
      editsAfter,
      untrackedChange,
      checksAlsoRevert: !unchanged && checkOf(copy.doc) !== checkOf(current),
    });
  }

  const titleOf = titleLookup(op);
  const flags: UndoImpact["flags"] = planFlags(runs, target, op, host).map((f) => ({
    wikiId: f.wikiId,
    flag: f.flag,
    title: titleOf(f.wikiId),
    restorable: host.getIndexFlags(f.wikiId) !== null,
  }));

  return { canUndo: true, pages, flags };
}

// ---------------------------------------------------------------------------
// 取り消し
// ---------------------------------------------------------------------------

type PageResult = { wikiId: string; ok: boolean; reason?: string };
type FlagResult = { wikiId: string; flag: FlagName; ok: boolean; reason?: string };

const errorReason = (e: unknown) => `error: ${e instanceof Error ? e.message : String(e)}`;

/**
 * 保守の操作を 1 回で取り消す（仕様 §5 の手順 1〜8）。
 * 断った場合は status: "refused"。実行した場合は項目ごとの結果を返す（一部の失敗は例外にしない）
 */
export async function undoMaintenanceOperation(
  host: MaintenanceHost,
  extras: UndoExtras,
  target: UndoTarget,
): Promise<UndoOutcome> {
  const storage = asMaintenanceStorage(host.provider());
  if (!storage) return { status: "refused", refusal: { code: "unsupported" } };

  // 同じ操作の取り消しが同時に 2 つ走らないよう、await の前に確保する
  const key = operationKey(target.runId, target.operationId);
  if (inFlight.has(key)) return { status: "refused", refusal: { code: "in_progress" } };
  inFlight.add(key);
  try {
    return await runUndo(host, extras, storage, target);
  } finally {
    inFlight.delete(key);
  }
}

async function runUndo(
  host: MaintenanceHost,
  extras: UndoExtras,
  storage: MaintenanceStorage,
  target: UndoTarget,
): Promise<UndoOutcome> {
  // 1. 対象と、その後の実行を読み直して判定し直す
  const { runs } = await loadRunsFrom(storage, target.runId);
  const ev = await evaluateTarget(storage, runs, target);
  if (!ev.ok) return { status: "refused", refusal: ev.refusal };
  const { op: targetOp, copies } = ev;

  const titleOf = titleLookup(targetOp);
  const plan = planFlags(runs, target, targetOp, host);

  // 2. 取り消し自身を記録する。related に、フラグを戻す対象を開始時に書く
  const run = await beginMaintenanceRun(host, {
    trigger: "undo",
    actor: extras.actor ?? { via: "app" },
  });
  const op = await run.beginOperation({
    kind: "undo",
    subject: targetOp.subject,
    related: plan.map((f) => ({
      wikiId: f.wikiId,
      title: titleOf(f.wikiId),
      role: f.flag === "archivedAt" ? ("archived" as const) : ("absorbed" as const),
    })),
    undoOf: target,
  });

  // 途中で例外になっても「取り消し済み」に見えないよう、未処理の項目は失敗で初期化する
  const pageResults: PageResult[] = targetOp.pages.map((p) => ({
    wikiId: p.wikiId,
    ok: false,
    reason: "aborted",
  }));
  const flagResults: FlagResult[] = plan.map((f) => ({
    wikiId: f.wikiId,
    flag: f.flag,
    ok: false,
    reason: "aborted",
  }));
  const restoredDocs: { wikiId: string; doc: GraphiumDocument }[] = [];
  const restoredPages: { wikiId: string; title: string }[] = [];
  const unchangedPages: { wikiId: string; title: string }[] = [];

  try {
    let author: Awaited<ReturnType<UndoExtras["getAuthor"]>> = {};
    try {
      author = await extras.getAuthor();
    } catch (e) {
      console.warn("[knowledge-maintenance] 実行者の取得に失敗（空で続けます）:", e);
    }

    // 3. 写しのあるページを順に戻す（ページの排他の中で）
    for (let i = 0; i < targetOp.pages.length; i++) {
      const page = targetOp.pages[i];
      const copy = copies.get(page.copyKey)!;
      try {
        await withPageLock(page.wikiId, async () => {
          await host.flushEditors(page.wikiId);
          const current = await host.loadWikiDocFresh(page.wikiId);
          if (!current) {
            pageResults[i] = { wikiId: page.wikiId, ok: false, reason: "missing" };
            return;
          }
          // やり直しで二重に書かない
          if (sameContent(current, copy.doc)) {
            pageResults[i] = { wikiId: page.wikiId, ok: true, reason: "unchanged" };
            unchangedPages.push({ wikiId: page.wikiId, title: page.title });
            return;
          }
          let restored = buildRestoredDocument(current, { ...copy.doc } as GraphiumDocument);
          restored = await recordRevision(restored, current.pages[0] ?? null, "maintenance_undo", {
            force: true,
            email: author.email,
            author: author.author,
          });
          // 写し → 保存は recorder がやる（排他はこちらが持っているので saveHoldingLock）
          await op.saveHoldingLock(page.wikiId, restored);
          pageResults[i] = { wikiId: page.wikiId, ok: true };
          restoredPages.push({ wikiId: page.wikiId, title: page.title });
          restoredDocs.push({ wikiId: page.wikiId, doc: restored });
        });
      } catch (e) {
        pageResults[i] = { wikiId: page.wikiId, ok: false, reason: errorReason(e) };
      }
    }

    // 4・5. フラグを逆順に戻す。現在のフラグが「いまあるべき値」と同じときだけ動かす
    const restoredFlags: { wikiId: string; flag: FlagName }[] = [];
    for (let i = 0; i < plan.length; i++) {
      const f = plan[i];
      try {
        const flags = host.getIndexFlags(f.wikiId);
        if (!flags) {
          flagResults[i] = { wikiId: f.wikiId, flag: f.flag, ok: false, reason: "not_in_index" };
          continue;
        }
        const current = flags[f.flag];
        if (current === f.before) {
          // 人がすでに手で戻している。触らない
          flagResults[i] = { wikiId: f.wikiId, flag: f.flag, ok: true, reason: "already_restored" };
          continue;
        }
        if (current !== f.expected) {
          flagResults[i] = { wikiId: f.wikiId, flag: f.flag, ok: false, reason: "flag_changed" };
          continue;
        }
        // before が無い → 立てた印を外す / before がある（取り消しの取り消し）→ もう一度立てる
        if (f.before === null) {
          if (f.flag === "deletedAt") await op.restoreFromTrash(f.wikiId);
          else await op.restoreFromArchive(f.wikiId);
        } else if (f.flag === "deletedAt") await op.trash(f.wikiId);
        else await op.archive(f.wikiId);
        const after = host.getIndexFlags(f.wikiId)?.[f.flag] ?? null;
        const applied = f.before === null ? after === null : after !== null;
        flagResults[i] = applied
          ? { wikiId: f.wikiId, flag: f.flag, ok: true }
          : { wikiId: f.wikiId, flag: f.flag, ok: false, reason: "not_applied" };
        if (applied) restoredFlags.push({ wikiId: f.wikiId, flag: f.flag });
      } catch (e) {
        flagResults[i] = { wikiId: f.wikiId, flag: f.flag, ok: false, reason: errorReason(e) };
      }
    }

    // 6. 戻したページごとに、検索用の埋め込み・開いているエディタの差し替えなど
    for (const { wikiId, doc } of restoredDocs) {
      try {
        await extras.afterRestore(wikiId, doc);
      } catch (e) {
        console.warn("[knowledge-maintenance] 取り消しのあとの処理に失敗:", wikiId, e);
      }
    }

    // 7. 結果を書いて閉じる。wiki-log に 1 件
    await op.end({ undoResult: { pages: pageResults, flags: flagResults } });
    const { id: undoOperationId } = op;
    await run.end();
    const failedPages = pageResults
      .filter((r) => !r.ok)
      .map((r) => ({ wikiId: r.wikiId, title: titleOf(r.wikiId), reason: r.reason ?? "" }));
    const failedFlags = flagResults
      .filter((r) => !r.ok)
      .map((r) => ({ wikiId: r.wikiId, flag: r.flag, reason: r.reason ?? "" }));
    try {
      await extras.logUndone?.({
        target,
        undoRunId: run.id,
        undoOperationId,
        subject: targetOp.subject,
        restoredPageCount: restoredPages.length,
        failedCount: failedPages.length + failedFlags.length,
      });
    } catch (e) {
      console.warn("[knowledge-maintenance] 取り消しのログの書き込みに失敗:", e);
    }

    // 8. 結果
    return {
      status: "done",
      undoRunId: run.id,
      undoOperationId,
      restoredPages,
      unchangedPages,
      failedPages,
      restoredFlags,
      failedFlags,
    };
  } catch (e) {
    // 想定外の例外でも、ここまでの結果（未処理は失敗）を残して閉じる
    await op.end({ undoResult: { pages: pageResults, flags: flagResults } }).catch(() => undefined);
    await run.end().catch(() => undefined);
    throw e;
  }
}
