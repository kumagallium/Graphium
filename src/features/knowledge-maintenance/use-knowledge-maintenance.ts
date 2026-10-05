// 保守の操作の記録・取り消し・一覧を note-app から使うためのフック
// 仕様: docs/internal/knowledge-maintenance-undo-spec-2026-10.md §4（差し込みを小さく保つ）・§5・§6
// features/wiki は import しない（逆向きの依存を作らない）。wiki 側の関数は引数で受ける

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphiumDocument } from "../../lib/document-types";
import type { WikiSaveOptions } from "../../hooks/use-file-manager";
import type { StorageProvider } from "../../lib/storage/types";
import type { AuthorIdentity } from "../document-provenance/types";
import {
  activeRunIds,
  beginMaintenanceRun,
  type MaintenanceHost,
  type MaintenanceRunHandle,
} from "./recorder";
import type { MaintenanceListBinding } from "./MaintenanceRunList";
import {
  deriveOperationStates,
  findBlockingOperations,
  operationKey,
  type BlockingOperation,
  type OperationStateInfo,
} from "./run-format";
import { loadRecentRuns, loadRunsFrom, purgeExpired } from "./run-store";
import { describeOperation, MAINTENANCE_OP_I18N_KEYS } from "./summary";
import {
  describeUndoImpact,
  undoMaintenanceOperation,
  type UndoImpact,
  type UndoOutcome,
  type UndoRefusal,
  type UndoTarget,
} from "./undo";
import { asMaintenanceStorage, type MaintenanceOperation, type MaintenanceRun } from "./types";

/** 最初に読む実行の数（「さらに読み込む」も同じ数ずつ） */
export const MAINTENANCE_LIST_PAGE_SIZE = 30;
/** 期限切れの掃除を始めるまでの待ち（起動直後の読み込みと競合させない） */
export const MAINTENANCE_PURGE_DELAY_MS = 5000;

type TFn = (key: string, params?: Record<string, string>) => string;

/** use-file-manager の戻り値のうち、このフックが使うものだけ（構造的な型） */
export type MaintenanceFileManager = {
  wikiMetas: ReadonlyMap<string, { title: string }>;
  activeFileId: string | null;
  loadWikiDocFresh: MaintenanceHost["loadWikiDocFresh"];
  getWikiIndexFlags: MaintenanceHost["getIndexFlags"];
  restoreWikiIndexFlag: MaintenanceHost["restoreWikiFlag"];
  handleSaveWikiFile: MaintenanceHost["saveWikiFile"];
  handleDeleteWikiFile: (wikiId: string) => Promise<unknown>;
  handleArchiveWikiFile: (wikiId: string) => Promise<unknown>;
  handleOpenWikiFile: (wikiId: string) => Promise<unknown> | void;
  /** いま保存中か（保存が false を返した理由の見分けに使う。use-file-manager の isSavingNow） */
  isSavingNow: () => boolean;
};

/** トーストに添える操作（取り消しの取り消しなど） */
export type MaintenanceNoticeAction = { label: string; onClick: () => void };

export type KnowledgeMaintenanceDeps = {
  fm: MaintenanceFileManager;
  /** getActiveProvider */
  getProvider: () => StorageProvider;
  /** ストレージの初期化が終わり、失敗していない */
  storageReady: boolean;
  /** プロバイダの切り替えを区別する */
  providerId: string;
  /** lib/peek-save-queue の flushPeekSaves */
  flushEditors: (noteId: string) => Promise<unknown> | null;
  /**
   * 開いているサイドピークへ内容を差し替える（lib/peek-save-queue の applyLiveExternalDocDetailed）。
   * applied = 差し替えた数、refused = 開いているのに差し替えを断った数（未保存・保存中など）。
   * メインエディタはこの口を持たない（数に入らない）ので、開き直しは activeFileId で判定する
   */
  applyLiveDoc: (noteId: string, doc: GraphiumDocument) => { applied: number; refused: number };
  /** embedWikiSections */
  embed: (wikiId: string, doc: GraphiumDocument) => Promise<unknown>;
  /** wikiLog.append */
  appendLog: (
    type: "undo",
    wikiIds: string[],
    summary: string,
    detail?: Record<string, unknown>,
  ) => Promise<unknown>;
  getAuthor: () => Promise<{ email?: string; author?: AuthorIdentity }>;
  /** window.confirm */
  confirm: (message: string) => boolean;
  /** トースト。action は「取り消す」など、押せる操作を添えるとき */
  notify: (kind: "success" | "error", message: string, action?: MaintenanceNoticeAction) => void;
  t: TFn;
};

export type RequestUndoResult =
  /** 確認で「しない」を選んだ */
  | { status: "cancelled" }
  /** 読み込み・実行の途中で想定外の例外になった */
  | { status: "error"; error: unknown }
  | UndoOutcome;

export type KnowledgeMaintenanceApi = {
  /** 実行を始める。end すると一覧を読み直す */
  beginRun: (trigger: MaintenanceRun["trigger"]) => Promise<MaintenanceRunHandle>;
  /** applyTopicMerges の groupScope に渡す。組ごとに操作を作り、記録された操作を覚える */
  topicMergeScope: (run: MaintenanceRunHandle) => TopicMergeGroupScope;
  /** この実行で記録された操作（トーストの「取り消す」用）。topicMergeScope の end で貯まり、取り出すと空になる */
  recordedOperationsOf: (run: MaintenanceRunHandle) => UndoTarget[];
  requestUndo: (target: UndoTarget) => Promise<RequestUndoResult>;
  /** 新しい順 */
  runs: MaintenanceRun[];
  states: Map<string, OperationStateInfo>;
  blockersOf: (target: UndoTarget) => BlockingOperation[];
  loading: boolean;
  hasMore: boolean;
  unreadableCount: number;
  loadMore: () => Promise<void>;
  /** 一覧を読み直す。一覧を一度も読み込んでいない（ensureLoaded 前）ときは何もしない */
  refresh: () => Promise<void>;
  /** 一覧が画面に出たときに呼ぶ。最初の 1 回だけ読み込む（2 回目以降は何もしない） */
  ensureLoaded: () => void;
  /** 一覧の置き場（ログ画面・履歴パネル）へ渡す束。中身が変わったときだけ作り直す */
  listBinding: MaintenanceListBinding;
  /** 読み込み済みの実行のうち、そのページが pages / flags / related / subject に関わる操作 */
  operationsForPage: (wikiId: string) => { run: MaintenanceRun; op: MaintenanceOperation }[];
};

export type TopicMergeGroupScope = (
  targetId: string,
  sourceIds: string[],
) => Promise<{
  handleSaveWikiFile: (wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions) => Promise<boolean>;
  handleDeleteWikiFile: (wikiId: string) => Promise<void>;
  end: () => Promise<void>;
}>;

// ---------------------------------------------------------------------------
// 文言の組み立て（純関数）
// ---------------------------------------------------------------------------

/** 操作の呼び名（妨げている操作の名指しに使う） */
export function operationTitle(op: MaintenanceOperation): string {
  return op.subject?.title ?? op.related[0]?.title ?? op.pages[0]?.title ?? "";
}

/** 操作の 1 行の文（describeOperation の結果を t に通したもの。数値の引数は文字列にそろえる） */
export function operationText(op: MaintenanceOperation, t: TFn): string {
  const d = describeOperation(op);
  return t(d.key, Object.fromEntries(Object.entries(d.params).map(([k, v]) => [k, String(v)])));
}

/** 取り消しを断るときの文言 */
export function buildUndoRefusalMessage(refusal: UndoRefusal, t: TFn): string {
  switch (refusal.code) {
    case "blocked": {
      // 新しい順に戻す導線になるよう、いちばん新しい妨げを名指しする。
      // ページ名ではなく、一覧の行と同じ 1 行の文で指す（同じページへの別々の操作を見分けられる）
      const latest = refusal.blockers[refusal.blockers.length - 1];
      return t("maintenance.undo.refused.blocked", { name: latest ? operationText(latest.op, t) : "" });
    }
    case "in_progress":
      return t("maintenance.undo.refused.inProgress");
    case "already_undone":
      return t("maintenance.undo.refused.alreadyUndone");
    case "not_found":
      return t("maintenance.undo.refused.notFound");
    case "copy_unreadable":
      return t("maintenance.undo.refused.copyUnreadable");
    case "unsupported":
      return t("maintenance.undo.refused.unsupported");
  }
}

/**
 * 取り消す前の確認の文言。該当するものだけを並べる
 * （操作のあとの編集・記録に残らない変更・出典照合の結果も戻る・完全に削除されていて戻せない）
 */
export function buildUndoConfirmMessage(
  impact: UndoImpact,
  title: string,
  t: TFn,
  /** 主対象が無く対象が複数（まとめてのアーカイブ）のときの件数。あれば 1 行目は件数入りの専用の文にする */
  manyCount?: number,
): string {
  const lines = [
    manyCount !== undefined
      ? t("maintenance.undo.confirmMany", { count: String(manyCount) })
      : t("maintenance.undo.confirm", { title }),
  ];
  const edits = impact.pages.reduce((sum, p) => sum + p.editsAfter, 0);
  if (edits > 0) lines.push(t("maintenance.undo.confirmEdits", { count: String(edits) }));
  if (impact.pages.some((p) => p.untrackedChange)) lines.push(t("maintenance.undo.confirmUntracked"));
  if (impact.pages.some((p) => p.checksAlsoRevert)) lines.push(t("maintenance.undo.confirmChecks"));
  for (const p of impact.pages) {
    if (p.deleted) lines.push(t("maintenance.undo.confirmMissingPage", { title: p.title }));
  }
  // 吸収された側がゴミ箱から完全に削除されている（索引に無い）
  const seen = new Set<string>();
  for (const f of impact.flags) {
    if (f.restorable || seen.has(f.wikiId)) continue;
    seen.add(f.wikiId);
    lines.push(t("maintenance.undo.confirmMissingFlag", { title: f.title }));
  }
  return lines.join("\n");
}

/** 取り消しの結果のトースト（失敗が 1 件でもあれば一部だけ） */
export function buildUndoDoneNotice(
  outcome: Extract<UndoOutcome, { status: "done" }>,
  t: TFn,
): { kind: "success" | "error"; message: string } {
  const failed = outcome.failedPages.length + outcome.failedFlags.length;
  if (failed > 0) {
    return { kind: "error", message: t("maintenance.undo.donePartial", { count: String(failed) }) };
  }
  return { kind: "success", message: t("maintenance.undo.done") };
}

/** 一覧用: そのページが pages / flags / related / subject に関わる操作だけ */
export function operationsTouchingPage(
  runs: MaintenanceRun[],
  wikiId: string,
): { run: MaintenanceRun; op: MaintenanceOperation }[] {
  const out: { run: MaintenanceRun; op: MaintenanceOperation }[] = [];
  for (const run of runs) {
    for (const op of run.operations) {
      if (
        op.subject?.wikiId === wikiId ||
        op.pages.some((p) => p.wikiId === wikiId) ||
        op.flags.some((f) => f.wikiId === wikiId) ||
        op.related.some((r) => r.wikiId === wikiId)
      ) {
        out.push({ run, op });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// フック
// ---------------------------------------------------------------------------

const keyOf = (r: MaintenanceRun) => r.id;
const byKeyDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

export function useKnowledgeMaintenance(deps: KnowledgeMaintenanceDeps): KnowledgeMaintenanceApi {
  // 数分かかる実行の途中でも最新を引けるよう、毎回 ref を更新して呼び出し時に読む
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const [runs, setRuns] = useState<MaintenanceRun[]>([]);
  const [unreadableKeys, setUnreadableKeys] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const runsRef = useRef<MaintenanceRun[]>([]);
  const unreadableRef = useRef<string[]>([]);
  const hasMoreRef = useRef(false);
  const loadingRef = useRef(false);
  /** 読み込みの世代。新しい読み込み・プロバイダの切り替えで古い結果を捨てる */
  const tokenRef = useRef(0);
  const mountedRef = useRef(true);
  /**
   * 一覧が必要とされた（ensureLoaded が呼ばれた）。立つまでは読み込まない
   * （取り消しを使わない人に余計な読み込みをさせない）。プロバイダが替わっても保つ
   */
  const wantedRef = useRef(false);
  /** 取り消しを実行中の操作の operationKey */
  const [undoingKey, setUndoingKey] = useState<string | null>(null);
  /** run.id → この実行で記録された操作 */
  const recordedRef = useRef(new Map<string, UndoTarget[]>());

  const commit = useCallback((nextRuns: MaintenanceRun[], nextUnreadable: string[], more: boolean) => {
    runsRef.current = nextRuns;
    unreadableRef.current = nextUnreadable;
    hasMoreRef.current = more;
    setRuns(nextRuns);
    setUnreadableKeys(nextUnreadable);
    setHasMore(more);
  }, []);

  /**
   * host を作る。1 つの実行（beginRun・取り消し）ごとに作るので、「記録を残せませんでした」の通知は
   * 実行ごとに 1 回だけになる（1 実行に操作が複数あっても、操作ごとには出さない）
   */
  const makeHost = useCallback((): MaintenanceHost => {
    // fm は呼び出し時に引く（開始時の古い関数を使い続けない）
    const fm = () => depsRef.current.fm;
    let unavailableNotified = false;
    return {
      provider: () => depsRef.current.getProvider(),
      isSaving: () => fm().isSavingNow(),
      onRecordingUnavailable: () => {
        if (unavailableNotified) return;
        unavailableNotified = true;
        const { notify, t } = depsRef.current;
        notify("error", t("maintenance.recordUnavailable"));
      },
      flushEditors: async (wikiId) => {
        await depsRef.current.flushEditors(`wiki:${wikiId}`);
      },
      loadWikiDocFresh: (wikiId) => fm().loadWikiDocFresh(wikiId),
      getIndexFlags: (wikiId) => fm().getWikiIndexFlags(wikiId),
      saveWikiFile: (wikiId, doc, options) => fm().handleSaveWikiFile(wikiId, doc, options),
      trashWiki: async (wikiId) => {
        await fm().handleDeleteWikiFile(wikiId);
      },
      archiveWiki: async (wikiId) => {
        await fm().handleArchiveWikiFile(wikiId);
      },
      restoreWikiFlag: (wikiId, flag) => fm().restoreWikiIndexFlag(wikiId, flag),
      now: () => new Date(),
      newId: () => crypto.randomUUID(),
    };
  }, []);

  // ---- 一覧の読み込み ----

  const load = useCallback(
    async (mode: "replace" | "more") => {
      const storage = asMaintenanceStorage(depsRef.current.getProvider());
      if (!storage) {
        tokenRef.current += 1;
        commit([], [], false);
        loadingRef.current = false;
        setLoading(false);
        return;
      }
      if (mode === "more" && (loadingRef.current || !hasMoreRef.current)) return;
      const token = ++tokenRef.current;
      loadingRef.current = true;
      setLoading(true);
      try {
        if (mode === "replace") {
          // 「さらに読み込む」で広げた分は保つ
          const limit = Math.max(MAINTENANCE_LIST_PAGE_SIZE, runsRef.current.length + unreadableRef.current.length);
          const res = await loadRecentRuns(storage, { limit });
          if (token !== tokenRef.current || !mountedRef.current) return;
          commit(res.runs, res.unreadable, res.hasMore);
        } else {
          const keys = [...runsRef.current.map(keyOf), ...unreadableRef.current];
          const beforeKey = keys.sort(byKeyDesc)[keys.length - 1];
          const res = await loadRecentRuns(storage, { limit: MAINTENANCE_LIST_PAGE_SIZE, beforeKey });
          if (token !== tokenRef.current || !mountedRef.current) return;
          const known = new Set(runsRef.current.map(keyOf));
          const merged = [...runsRef.current, ...res.runs.filter((r) => !known.has(r.id))].sort((a, b) =>
            byKeyDesc(a.id, b.id),
          );
          commit(merged, [...unreadableRef.current, ...res.unreadable], res.hasMore);
        }
      } catch (e) {
        console.warn("[knowledge-maintenance] 保守の操作の一覧の読み込みに失敗:", e);
      } finally {
        if (token === tokenRef.current) {
          loadingRef.current = false;
          if (mountedRef.current) setLoading(false);
        }
      }
    },
    [commit],
  );

  // 実行が終わったときの読み直し。一覧が必要とされていない（読み込んでいない）ときは何もしない
  const refresh = useCallback(async () => {
    if (!wantedRef.current) return;
    await load("replace");
  }, [load]);
  const loadMore = useCallback(() => load("more"), [load]);
  // 一覧が画面に出たときに呼ばれる。最初の 1 回だけ読む。ストレージの準備前なら、
  // 準備ができたときに下の effect が読む
  const ensureLoaded = useCallback(() => {
    if (wantedRef.current) return;
    wantedRef.current = true;
    if (depsRef.current.storageReady) void load("replace");
  }, [load]);

  // プロバイダが替わるたびに一覧を空にする。一覧が必要とされていれば、準備ができたあと最初の 30 実行を読む
  // （起動時には読まない。ensureLoaded が呼ばれてから）
  const { storageReady, providerId } = deps;
  useEffect(() => {
    mountedRef.current = true; // StrictMode で戻さないと dev で更新が止まる
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    tokenRef.current += 1; // 切り替え前の読み込みの結果を捨てる
    loadingRef.current = false;
    commit([], [], false);
    if (!storageReady) {
      setLoading(false);
      return;
    }
    if (wantedRef.current) void load("replace");
    else setLoading(false);
  }, [storageReady, providerId, commit, load]);

  // ---- 期限切れの掃除（仕様 §6）。プロバイダごとに 1 回、数秒おいて裏で ----
  const purgedForRef = useRef(new Set<string>());
  useEffect(() => {
    if (!storageReady) return;
    if (purgedForRef.current.has(providerId)) return;
    const timer = setTimeout(() => {
      // タイマーが実際に走ったときに「済み」にする（StrictMode の 2 回目の effect でも止まらない）
      purgedForRef.current.add(providerId);
      const storage = asMaintenanceStorage(depsRef.current.getProvider());
      if (!storage) return;
      purgeExpired(storage, new Date()).then(
        (res) => {
          if (res.deleted > 0) console.info("[knowledge-maintenance] 期限切れの記録を削除:", res.deleted);
        },
        (e) => console.warn("[knowledge-maintenance] 期限切れの掃除に失敗:", e),
      );
    }, MAINTENANCE_PURGE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [storageReady, providerId]);

  // ---- 記録 ----

  const beginRun = useCallback(
    async (trigger: MaintenanceRun["trigger"]): Promise<MaintenanceRunHandle> => {
      const run = await beginMaintenanceRun(makeHost(), { trigger, actor: { via: "app" } });
      return {
        ...run,
        // 閉じたら一覧を読み直す（読み直しの失敗は握る）
        end: async () => {
          try {
            return await run.end();
          } finally {
            void refresh();
          }
        },
      };
    },
    [makeHost, refresh],
  );

  const topicMergeScope = useCallback(
    (run: MaintenanceRunHandle): TopicMergeGroupScope =>
      async (targetId, sourceIds) => {
        const titleOf = (id: string) => depsRef.current.fm.wikiMetas.get(id)?.title ?? id;
        const op = await run.beginOperation({
          kind: "merge_topics",
          subject: { wikiId: targetId, title: titleOf(targetId) },
          related: sourceIds.map((id) => ({ wikiId: id, title: titleOf(id), role: "absorbed" as const })),
        });
        return {
          handleSaveWikiFile: (wikiId, doc, options) => op.save(wikiId, doc, options),
          handleDeleteWikiFile: (wikiId) => op.trash(wikiId),
          end: async () => {
            const res = await op.end();
            if (res.recorded && res.runId) {
              const list = recordedRef.current.get(res.runId) ?? [];
              list.push({ runId: res.runId, operationId: res.operationId });
              recordedRef.current.set(res.runId, list);
            }
          },
        };
      },
    [],
  );

  const recordedOperationsOf = useCallback(
    (run: MaintenanceRunHandle): UndoTarget[] => {
      // 取り出したら忘れる（実行の数だけ増え続けないように）
      const list = recordedRef.current.get(run.id) ?? [];
      recordedRef.current.delete(run.id);
      return [...list];
    },
    [],
  );

  // ---- 取り消し ----

  /** 取り消しの本体（確認 → 実行 → 通知）。requestUndo が実行中の印を付けて呼ぶ */
  const runRequestUndo = useCallback(
    async (target: UndoTarget): Promise<RequestUndoResult> => {
      const d = () => depsRef.current;
      const refuse = (refusal: UndoRefusal): RequestUndoResult => {
        d().notify("error", buildUndoRefusalMessage(refusal, d().t));
        return { status: "refused", refusal };
      };
      try {
        const host = makeHost();
        const storage = asMaintenanceStorage(host.provider());
        if (!storage) return refuse({ code: "unsupported" });

        // 対象の実行以降を読んで、断る理由と影響を見積もる
        const { runs: loaded } = await loadRunsFrom(storage, target.runId);
        const impact = await describeUndoImpact(host, loaded, target);
        if (!impact.canUndo) return refuse(impact.refusal ?? { code: "not_found" });

        const targetOp = loaded
          .find((r) => r.id === target.runId)
          ?.operations.find((o) => o.id === target.operationId);
        const title = targetOp ? operationTitle(targetOp) : "";
        // 主対象が無く対象が複数（まとめてのアーカイブ）: 1 件の名前ではなく件数入りの専用の文にする
        const manyCount =
          targetOp && !targetOp.subject && targetOp.related.length > 1 ? targetOp.related.length : undefined;
        if (!d().confirm(buildUndoConfirmMessage(impact, title, d().t, manyCount))) return { status: "cancelled" };

        const restoredIds: string[] = [];
        // 開いているサイドピークが差し替えを断った（取り消しがその画面に反映されていない）
        let peekRefused = false;
        const outcome = await undoMaintenanceOperation(
          host,
          {
            getAuthor: () => d().getAuthor(),
            afterRestore: async (wikiId, doc) => {
              restoredIds.push(wikiId);
              const noteId = `wiki:${wikiId}`;
              // 書き戻しのあとに打たれた編集があれば先に書き出す（ピークは未保存だと差し替えを断る）
              try {
                await d().flushEditors(noteId);
              } catch (e) {
                console.warn("[knowledge-maintenance] 取り消し後の書き出しに失敗:", wikiId, e);
              }
              // 開いているサイドピークを戻した内容に差し替える
              const { refused } = d().applyLiveDoc(noteId, doc);
              if (refused > 0) peekRefused = true;
              // メインエディタは差し替えの口を持たないので、開いていれば必ず開き直す
              // （ピークと両方で開いているときも。古い内容のままだと次の自動保存が取り消しを上書きする）
              if (d().fm.activeFileId === noteId) {
                await d().fm.handleOpenWikiFile(wikiId);
              }
              // 検索用の埋め込みの取り直しは最後（数秒かかる。失敗は握る）
              try {
                await d().embed(wikiId, doc);
              } catch (e) {
                console.warn("[knowledge-maintenance] 取り消し後の埋め込みの取り直しに失敗:", wikiId, e);
              }
            },
            logUndone: async (info) => {
              const ids = [
                ...new Set([
                  ...(info.subject ? [info.subject.wikiId] : []),
                  ...restoredIds,
                  ...info.restoredFlags.map((f) => f.wikiId),
                ]),
              ];
              const summary = info.subject
                ? d().t(MAINTENANCE_OP_I18N_KEYS.undo, { title: info.subject.title })
                : d().t(MAINTENANCE_OP_I18N_KEYS.undo_generic, { count: String(ids.length) });
              await d().appendLog("undo", ids, summary, {
                runId: info.target.runId,
                operationId: info.target.operationId,
                undoRunId: info.undoRunId,
                undoOperationId: info.undoOperationId,
                restoredPageCount: info.restoredPageCount,
                restoredFlagCount: info.restoredFlags.length,
                failedCount: info.failedCount,
              });
            },
          },
          target,
        );

        if (outcome.status === "refused") {
          refuse(outcome.refusal);
        } else {
          const notice = buildUndoDoneNotice(outcome, d().t);
          // 取り消しの取り消し: 成功で、実際に何かを戻して記録が残ったときだけ「取り消す」を添える
          // （何も戻さなかった取り消しは操作が残らないので、取り消す対象が無い）
          const undoTarget: UndoTarget = { runId: outcome.undoRunId, operationId: outcome.undoOperationId };
          const undoOfUndo: MaintenanceNoticeAction | undefined =
            notice.kind === "success" &&
            outcome.undoRunId &&
            outcome.restoredPages.length + outcome.restoredFlags.length > 0
              ? {
                  label: d().t("maintenance.toast.undo"),
                  onClick: () => {
                    void requestUndoRef.current(undoTarget);
                  },
                }
              : undefined;
          if (undoOfUndo) d().notify(notice.kind, notice.message, undoOfUndo);
          else d().notify(notice.kind, notice.message);
          // 開いているサイドピークに反映できなかったときは、そのまま編集すると取り消しが
          // 上書きされるので、開き直すよう知らせる
          if (peekRefused) d().notify("error", d().t("maintenance.undo.peekNotUpdated"));
        }
        await refresh();
        return outcome;
      } catch (error) {
        console.warn("[knowledge-maintenance] 取り消しに失敗:", error);
        d().notify("error", d().t("maintenance.undo.failed"));
        void refresh();
        return { status: "error", error };
      }
    },
    [makeHost, refresh],
  );

  // 取り消しの通知の「取り消す」（取り消しの取り消し）から自分自身を呼ぶための参照
  const requestUndoRef = useRef<(target: UndoTarget) => Promise<RequestUndoResult>>(
    async () => ({ status: "cancelled" }),
  );
  /** 取り消しを頼む。実行中の操作の印（undoingKey）を付け、終わったら外す */
  const requestUndo = useCallback(
    async (target: UndoTarget): Promise<RequestUndoResult> => {
      const key = operationKey(target.runId, target.operationId);
      setUndoingKey(key);
      try {
        return await runRequestUndo(target);
      } finally {
        setUndoingKey((cur) => (cur === key ? null : cur));
      }
    },
    [runRequestUndo],
  );
  requestUndoRef.current = requestUndo;

  // ---- 一覧用 ----

  const states = useMemo(() => deriveOperationStates(runs, activeRunIds()), [runs]);
  const blockersOf = useCallback(
    (target: UndoTarget) => findBlockingOperations(runs, target, activeRunIds()),
    [runs],
  );
  const operationsForPage = useCallback(
    (wikiId: string) => operationsTouchingPage(runs, wikiId),
    [runs],
  );
  const onUndo = useCallback(
    (target: UndoTarget) => {
      void requestUndo(target);
    },
    [requestUndo],
  );
  const unreadableCount = unreadableKeys.length;
  const onLoadMore = useCallback(() => {
    void loadMore();
  }, [loadMore]);
  // 一覧の置き場へ渡す束。中身が変わったときだけ作り直す（受け取る側の effect が不必要に走らない）
  const listBinding = useMemo<MaintenanceListBinding>(
    () => ({
      runs,
      states,
      blockersOf,
      onUndo,
      undoingKey,
      loading,
      hasMore,
      unreadableCount,
      onLoadMore,
      ensureLoaded,
    }),
    [runs, states, blockersOf, onUndo, undoingKey, loading, hasMore, unreadableCount, onLoadMore, ensureLoaded],
  );

  return {
    beginRun,
    topicMergeScope,
    recordedOperationsOf,
    requestUndo,
    runs,
    states,
    blockersOf,
    loading,
    hasMore,
    unreadableCount,
    loadMore,
    refresh,
    ensureLoaded,
    listBinding,
    operationsForPage,
  };
}
