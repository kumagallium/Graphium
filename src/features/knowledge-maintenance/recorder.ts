// 保守の実行・操作の記録（取り消し用の写しを保存の直前に残す）
// 仕様: docs/internal/knowledge-maintenance-undo-spec-2026-10.md §4
// 依存の向き: wiki / note-app → knowledge-maintenance → version-snapshots・document-provenance・lib

import type { WikiSaveOptions } from "../../hooks/use-file-manager";
import type { GraphiumDocument } from "../../lib/document-types";
import { makeCopyKey, makeRunKey, sameContent, toDocCopy } from "./run-format";
import { deletePageCopy, deleteRun, loadPageCopy, saveRunMeta, writePageCopy } from "./run-store";
import { withPageLock } from "./page-lock";
import {
  asMaintenanceStorage,
  type MaintenanceActor,
  type MaintenanceStorageLike,
  type MaintenanceOperation,
  type MaintenanceOperationKind,
  type MaintenancePageCopyFile,
  type MaintenanceRun,
  type MaintenanceTrigger,
} from "./types";

/** 元の保存が false（保存中）を返したときに試す回数（最初の 1 回を含む） */
export const SAVE_MAX_ATTEMPTS = 5;
/** 再試行の間隔の基準（ms）。n 回目の失敗のあと base * n 待つ */
const SAVE_RETRY_BASE_MS = 250;

/**
 * 元の保存が「保存中」で何度試しても通らなかったときのエラー。
 * 呼び出し側は isMaintenanceSaveBusy で判定して、画面用の文言（maintenance.saveBusy）に直す
 */
export class MaintenanceSaveBusyError extends Error {
  readonly code = "save_busy" as const;
  readonly wikiId: string;
  constructor(wikiId: string, attempts: number) {
    super(`saveWikiFile returned false ${attempts} times: ${wikiId}`);
    this.name = "MaintenanceSaveBusyError";
    this.wikiId = wikiId;
  }
}

/** retrySave が投げた「保存中で諦めた」エラーか */
export function isMaintenanceSaveBusy(err: unknown): err is MaintenanceSaveBusyError {
  return (
    err instanceof MaintenanceSaveBusyError ||
    (err instanceof Error && (err as { code?: unknown }).code === "save_busy")
  );
}

/**
 * 元の保存が false を返したが、保存中ではなく失敗だった（書き込みの例外など）ときのエラー。
 * 再試行しても通らないので待たずに投げる。呼び出し側は isMaintenanceSaveFailed で判定する
 */
export class MaintenanceSaveFailedError extends Error {
  readonly code = "save_failed" as const;
  readonly wikiId: string;
  constructor(wikiId: string) {
    super(`saveWikiFile failed (not busy): ${wikiId}`);
    this.name = "MaintenanceSaveFailedError";
    this.wikiId = wikiId;
  }
}

/** retrySave が投げた「保存の失敗」エラーか */
export function isMaintenanceSaveFailed(err: unknown): err is MaintenanceSaveFailedError {
  return (
    err instanceof MaintenanceSaveFailedError ||
    (err instanceof Error && (err as { code?: unknown }).code === "save_failed")
  );
}

/**
 * 操作の途中で取り消し用の写しが書けなかったときのエラー（その保存はしていない）。
 * 呼び出し側は isMaintenanceRecordFailed で判定して、画面用の文言に直す。元の原因は cause
 */
export class MaintenanceRecordError extends Error {
  readonly code = "record_failed" as const;
  readonly wikiId: string;
  constructor(wikiId: string, cause: unknown) {
    super(`maintenance record failed: ${wikiId}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "MaintenanceRecordError";
    this.wikiId = wikiId;
    (this as { cause?: unknown }).cause = cause;
  }
}

/** 写しが書けなかったエラーか */
export function isMaintenanceRecordFailed(err: unknown): err is MaintenanceRecordError {
  return (
    err instanceof MaintenanceRecordError ||
    (err instanceof Error && (err as { code?: unknown }).code === "record_failed")
  );
}

export type MaintenanceHost = {
  provider: () => MaintenanceStorageLike;
  /** 開いているエディタの未保存の編集を書き出して待つ（lib/peek-save-queue の flushPeekSaves("wiki:<id>")） */
  flushEditors: (wikiId: string) => Promise<void>;
  /** ストレージから読む（loadWikiFile）。読めなければキャッシュ。どちらも無ければ null */
  loadWikiDocFresh: (wikiId: string) => Promise<GraphiumDocument | null>;
  /** 索引のフラグ。索引に無ければ null */
  getIndexFlags: (wikiId: string) => { deletedAt: string | null; archivedAt: string | null } | null;
  saveWikiFile: (wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions) => Promise<boolean>;
  /**
   * いま保存中か。元の保存は「保存中で捨てた」ときも「書き込みの例外」のときも false を返すので、
   * false のあとにこれで見分ける。省略時は（今までどおり）保存中とみなして再試行する
   */
  isSaving?: () => boolean;
  /**
   * 実行のメタが書けず、記録なしで素通しにしたときに呼ぶ（利用者に知らせる用。フック側で 1 回だけにする）。
   * 呼び出しが例外でも握る
   */
  onRecordingUnavailable?: (err: unknown) => void;
  trashWiki: (wikiId: string) => Promise<void>;
  archiveWiki: (wikiId: string) => Promise<void>;
  /** 索引のフラグだけを戻す（refreshFiles を呼ばない） */
  restoreWikiFlag: (wikiId: string, flag: "deletedAt" | "archivedAt") => Promise<void>;
  now: () => Date;
  /** uuid 形式の id を返す（実行のキーにも使う） */
  newId: () => string;
  /** 再試行の待ち。テストで差し替える。省略時は setTimeout */
  sleep?: (ms: number) => Promise<void>;
};

export type MaintenanceOperationInit = {
  kind: MaintenanceOperationKind;
  subject?: { wikiId: string; title: string };
  related?: MaintenanceOperation["related"];
  /** kind が "undo" のとき、取り消す対象 */
  undoOf?: { runId: string; operationId: string };
};

export type MaintenanceOperationEndOptions = {
  note?: string;
  /** kind が "undo" のとき、項目ごとの結果 */
  undoResult?: MaintenanceOperation["undoResult"];
};

export type MaintenanceOperationEndResult = {
  /** 実行のメタに操作が残ったか（空の操作・記録なしの素通しは false） */
  recorded: boolean;
  runId: string;
  operationId: string;
};

export type MaintenanceOperationHandle = {
  readonly id: string;
  readonly runId: string;
  /** 記録している（ストレージが非対応なら false。操作は素通しで動く） */
  readonly recording: boolean;
  /** 排他 → flushEditors → 現在の内容 → 写し → メタ → 元の保存。false は再試行して最後は例外 */
  save(wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions): Promise<boolean>;
  /**
   * 呼び出し側がすでに withPageLock(wikiId) を保持しているときの save。
   * 排他は入れ子にできない（デッドロックする）ため、取り消しがこちらを使う
   */
  saveHoldingLock(wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions): Promise<boolean>;
  trash(wikiId: string): Promise<void>;
  archive(wikiId: string): Promise<void>;
  restoreFromTrash(wikiId: string): Promise<void>;
  restoreFromArchive(wikiId: string): Promise<void>;
  end(options?: MaintenanceOperationEndOptions): Promise<MaintenanceOperationEndResult>;
};

export type MaintenanceRunHandle = {
  /** 実行のキー（"maint-run-…"）。記録なしの素通しでは空文字 */
  readonly id: string;
  readonly recording: boolean;
  beginOperation(init: MaintenanceOperationInit): Promise<MaintenanceOperationHandle>;
  /** 閉じていない操作を閉じ、操作が 0 件ならメタを消す */
  end(): Promise<{ recorded: boolean }>;
};

// ---------------------------------------------------------------------------
// いま動いている実行
// ---------------------------------------------------------------------------

const activeRuns = new Set<string>();

/** このセッションでいま動いている実行の id（取り消しの「中断された操作」判定に使う） */
export function activeRunIds(): ReadonlySet<string> {
  return new Set(activeRuns);
}

let warnedUnsupported = false;
function warnUnsupportedOnce() {
  if (warnedUnsupported) return;
  warnedUnsupported = true;
  console.warn(
    "[knowledge-maintenance] このストレージは appData の読み書き・列挙・削除に対応していないため、保守の操作を記録しません",
  );
}

/** テスト用: 「コンソールに 1 回だけ出す」の状態を戻す */
export function resetUnsupportedWarningForTest() {
  warnedUnsupported = false;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

function flagValue(
  host: MaintenanceHost,
  wikiId: string,
  flag: "deletedAt" | "archivedAt",
): string | null {
  return host.getIndexFlags(wikiId)?.[flag] ?? null;
}

type FlagAction = { flag: "deletedAt" | "archivedAt"; set: boolean };

/** 記録なしの素通し: 索引のフラグだけ決まりどおりに動かす（立っているものは触らない） */
async function applyFlagPassthrough(host: MaintenanceHost, wikiId: string, a: FlagAction) {
  const current = flagValue(host, wikiId, a.flag);
  if (a.set ? current : !current) return;
  if (a.set) await (a.flag === "deletedAt" ? host.trashWiki(wikiId) : host.archiveWiki(wikiId));
  else await host.restoreWikiFlag(wikiId, a.flag);
}

async function retrySave(
  host: MaintenanceHost,
  wikiId: string,
  doc: GraphiumDocument,
  options: WikiSaveOptions | undefined,
): Promise<boolean> {
  const sleep = host.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; attempt <= SAVE_MAX_ATTEMPTS; attempt++) {
    if (await host.saveWikiFile(wikiId, doc, options)) return true;
    // false は「保存中で捨てた」か「書き込みの例外」。保存中でないと分かれば、再試行せず失敗にする
    if (host.isSaving && !host.isSaving()) throw new MaintenanceSaveFailedError(wikiId);
    // 保存中なら偽成功にせず、間隔を空けて試す
    if (attempt < SAVE_MAX_ATTEMPTS) await sleep(SAVE_RETRY_BASE_MS * attempt);
  }
  throw new MaintenanceSaveBusyError(wikiId, SAVE_MAX_ATTEMPTS);
}

/** 記録なしの素通しの操作（recording: false）。保存・フラグは決まりどおりに動かすだけ */
function makePassthroughOperation(host: MaintenanceHost): MaintenanceOperationHandle {
  const saveOnce = (wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions) =>
    host.saveWikiFile(wikiId, doc, options);
  return {
    id: "",
    runId: "",
    recording: false,
    save: saveOnce,
    saveHoldingLock: saveOnce,
    trash: (id) => applyFlagPassthrough(host, id, { flag: "deletedAt", set: true }),
    archive: (id) => applyFlagPassthrough(host, id, { flag: "archivedAt", set: true }),
    restoreFromTrash: (id) => applyFlagPassthrough(host, id, { flag: "deletedAt", set: false }),
    restoreFromArchive: (id) => applyFlagPassthrough(host, id, { flag: "archivedAt", set: false }),
    end: async () => ({ recorded: false, runId: "", operationId: "" }),
  };
}

function makePassthroughRun(host: MaintenanceHost): MaintenanceRunHandle {
  return {
    id: "",
    recording: false,
    beginOperation: async () => makePassthroughOperation(host),
    end: async () => ({ recorded: false }),
  };
}

/** 実行を始める。ストレージが非対応なら、記録なしで素通しするハンドルを返す */
export async function beginMaintenanceRun(
  host: MaintenanceHost,
  init: { trigger: MaintenanceTrigger; actor: MaintenanceActor },
): Promise<MaintenanceRunHandle> {
  const storage = asMaintenanceStorage(host.provider());
  if (!storage) {
    warnUnsupportedOnce();
    return makePassthroughRun(host);
  }

  const startedAt = host.now();
  const run: MaintenanceRun = {
    formatVersion: 1,
    id: makeRunKey(startedAt, host.newId()),
    startedAt: startedAt.toISOString(),
    trigger: init.trigger,
    actor: init.actor,
    operations: [],
  };
  activeRuns.add(run.id);

  // 実行のメタへの書き込みは直列にする（書く時点の run を丸ごと書くので、順序が入れ替わっても最新に収束する）
  let tail: Promise<unknown> = Promise.resolve();
  let persisted = false;
  let nextCopySeq = 0;
  let runEnded = false;
  const openOps = new Set<{ end: () => Promise<unknown> }>();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const p = tail.then(task);
    tail = p.catch(() => undefined);
    return p;
  };
  const persist = (): Promise<void> =>
    enqueue(async () => {
      await saveRunMeta(storage, run);
      persisted = true;
    });

  const beginOperation = async (opInit: MaintenanceOperationInit): Promise<MaintenanceOperationHandle> => {
    if (runEnded) throw new Error("maintenance run already ended");
    const op: MaintenanceOperation = {
      id: host.newId(),
      kind: opInit.kind,
      startedAt: host.now().toISOString(),
      ...(opInit.subject ? { subject: { ...opInit.subject } } : {}),
      related: (opInit.related ?? []).map((r) => ({ ...r })),
      pages: [],
      flags: [],
      status: "running",
      ...(opInit.undoOf ? { undoOf: { ...opInit.undoOf } } : {}),
    };
    run.operations.push(op);
    try {
      // 関係するページを開始時に書く（途中で落ちても何を動かすつもりだったか分かる）
      await persist();
    } catch (e) {
      // 実行のメタが書けない（ストレージの書き込みエラー）。書きかけの操作を外し、
      // 例外にせず記録なしの素通しにする（保守の操作そのものは今までどおり動かす）
      run.operations = run.operations.filter((o) => o !== op);
      console.warn("[knowledge-maintenance] 実行のメタが書けないため、この操作は記録なしで進めます:", e);
      try {
        host.onRecordingUnavailable?.(e);
      } catch (notifyErr) {
        console.warn("[knowledge-maintenance] 記録できない通知に失敗:", notifyErr);
      }
      return makePassthroughOperation(host);
    }
    return makeOperationHandle(op);
  };

  const makeOperationHandle = (op: MaintenanceOperation): MaintenanceOperationHandle => {
    /** 1 操作の中で写しを取った（または新規で写しなしと確かめた）ページ */
    const seen = new Set<string>();
    let endPromise: Promise<MaintenanceOperationEndResult> | null = null;
    const handleForEnd = { end: () => handle.end() };
    openOps.add(handleForEnd);

    const assertOpen = () => {
      if (endPromise) throw new Error("maintenance operation already ended");
    };

    /** 最初の書き換えの直前に 1 回だけ時刻を入れる（操作の新旧を決める。persist で一緒に書かれる）。入れたら true */
    const markFirstWrite = (): boolean => {
      if (op.firstWriteAt) return false;
      op.firstWriteAt = host.now().toISOString();
      return true;
    };

    /** 呼び出し側が排他を保持している前提の本体 */
    const saveLocked = async (
      wikiId: string,
      doc: GraphiumDocument,
      options?: WikiSaveOptions,
    ): Promise<boolean> => {
      assertOpen();
      if (!seen.has(wikiId)) {
        // 写しは保存の直前に取る。未保存の編集を先に書き出してから現在の内容を読む
        await host.flushEditors(wikiId);
        const current = await host.loadWikiDocFresh(wikiId);
        if (current) {
          const copyKey = makeCopyKey(run.id, nextCopySeq++);
          const file: MaintenancePageCopyFile = {
            formatVersion: 1,
            runId: run.id,
            operationId: op.id,
            wikiId,
            capturedAt: host.now().toISOString(),
            doc: toDocCopy(current),
          };
          const entry = { wikiId, title: current.title, copyKey };
          const marked = markFirstWrite();
          try {
            await writePageCopy(storage, copyKey, file);
            op.pages.push(entry);
            await persist();
          } catch (e) {
            // 写しとメタが揃わなければ保存しない。残った分は片付ける（失敗しても握る）
            op.pages = op.pages.filter((p) => p !== entry);
            if (marked && op.pages.length === 0 && op.flags.length === 0) delete op.firstWriteAt;
            await deletePageCopy(storage, copyKey).catch(() => undefined);
            // 呼び出し側が文言に直せるよう専用のエラーで包む（その保存はしない）
            throw new MaintenanceRecordError(wikiId, e);
          }
        }
        // 現在の内容が読めないページ（新規）は写しなしで保存する。2 回目以降は写さない
        seen.add(wikiId);
      }
      return retrySave(host, wikiId, doc, options);
    };

    const recordFlag = async (wikiId: string, flag: "deletedAt" | "archivedAt", before: string | null) => {
      const after = flagValue(host, wikiId, flag);
      if (after === before) return; // 実際に変わったものだけ記録する
      op.flags.push({ wikiId, flag, before, after });
      try {
        await persist();
      } catch (e) {
        // 変化は済んでいる。メモリには残したので、次のメタの書き込み（op.end など）で一緒に書かれる
        console.warn("[knowledge-maintenance] フラグの記録の書き込みに失敗:", wikiId, flag, e);
      }
    };

    const applyFlag = async (wikiId: string, a: FlagAction) => {
      assertOpen();
      const before = flagValue(host, wikiId, a.flag);
      if (a.set ? before : !before) return; // すでにその状態なら何もしない（記録もしない）
      markFirstWrite();
      if (a.set) await (a.flag === "deletedAt" ? host.trashWiki(wikiId) : host.archiveWiki(wikiId));
      else await host.restoreWikiFlag(wikiId, a.flag);
      await recordFlag(wikiId, a.flag, before);
    };

    const end = (endOptions?: MaintenanceOperationEndOptions): Promise<MaintenanceOperationEndResult> => {
      if (endPromise) return endPromise;
      endPromise = (async () => {
        openOps.delete(handleForEnd);
        // 変わらなかった写しを捨てる（現在の内容と sameContent なもの）
        const dropped: string[] = [];
        for (const entry of [...op.pages]) {
          let unchanged = false;
          try {
            const [current, copy] = await Promise.all([
              host.loadWikiDocFresh(entry.wikiId),
              loadPageCopy(storage, entry.copyKey),
            ]);
            unchanged = !!current && !!copy && sameContent(current, copy.doc);
          } catch {
            unchanged = false; // 比べられないときは残す（取り消せる側に倒す）
          }
          if (unchanged) {
            op.pages = op.pages.filter((p) => p !== entry);
            dropped.push(entry.copyKey);
          }
        }

        // 取り消しの記録は、何も変わらなくても残す（「取り消し済み」を導くため）
        const keepEmptyUndo = op.kind === "undo" && !!endOptions?.undoResult;
        const empty = op.pages.length === 0 && op.flags.length === 0 && !keepEmptyUndo;
        if (empty) {
          run.operations = run.operations.filter((o) => o !== op);
        } else {
          op.status = "applied";
          op.endedAt = host.now().toISOString();
          if (endOptions?.note !== undefined) op.note = endOptions.note;
          if (endOptions?.undoResult) op.undoResult = endOptions.undoResult;
        }

        // メタを先に書き、書けてから写しを消す（メタが指す写しを先に消さない）
        let metaWritten = false;
        try {
          await persist();
          metaWritten = true;
        } catch (e) {
          console.warn("[knowledge-maintenance] 操作の終了の書き込みに失敗:", op.id, e);
        }
        if (metaWritten) {
          for (const key of dropped) await deletePageCopy(storage, key).catch(() => undefined);
        }
        return { recorded: !empty, runId: run.id, operationId: op.id };
      })();
      return endPromise;
    };

    const handle: MaintenanceOperationHandle = {
      id: op.id,
      runId: run.id,
      recording: true,
      save: (wikiId, doc, options) => withPageLock(wikiId, () => saveLocked(wikiId, doc, options)),
      saveHoldingLock: saveLocked,
      trash: (id) => applyFlag(id, { flag: "deletedAt", set: true }),
      archive: (id) => applyFlag(id, { flag: "archivedAt", set: true }),
      restoreFromTrash: (id) => applyFlag(id, { flag: "deletedAt", set: false }),
      restoreFromArchive: (id) => applyFlag(id, { flag: "archivedAt", set: false }),
      end,
    };
    return handle;
  };

  const end = async (): Promise<{ recorded: boolean }> => {
    if (runEnded) return { recorded: run.operations.length > 0 };
    runEnded = true;
    try {
      // 閉じ忘れの操作があっても running のまま残さない
      for (const h of [...openOps]) await h.end();
      run.endedAt = host.now().toISOString();
      if (run.operations.length === 0) {
        // 空の実行を残さない
        if (persisted) {
          try {
            await enqueue(() => deleteRun(storage, run.id));
          } catch (e) {
            console.warn("[knowledge-maintenance] 空の実行の削除に失敗:", run.id, e);
          }
        }
      } else {
        try {
          await persist();
        } catch (e) {
          console.warn("[knowledge-maintenance] 実行の終了の書き込みに失敗:", run.id, e);
        }
      }
    } finally {
      activeRuns.delete(run.id);
    }
    return { recorded: run.operations.length > 0 };
  };

  return { id: run.id, recording: true, beginOperation, end };
}
