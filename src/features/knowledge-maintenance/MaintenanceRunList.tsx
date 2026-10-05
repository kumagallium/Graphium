// 保守の操作の一覧（新しい順）。1 実行に操作が複数あるときだけ実行の見出しを出す。
// 画面の組み込みは別段（Storybook で合意してから）。

import { Loader2 } from "lucide-react";
import { useT } from "../../i18n";
import { formatDateTime } from "../version-snapshots/SnapshotRow";
import { MaintenanceOperationRow, operationSentence } from "./MaintenanceOperationRow";
import { operationKey, type BlockingOperation, type OperationStateInfo } from "./run-format";
import type { UndoTarget } from "./undo";
import type { MaintenanceOperation, MaintenanceOperationState, MaintenanceRun } from "./types";

export type MaintenanceRunListProps = {
  /** 新しい順 */
  runs: MaintenanceRun[];
  /** キーは run-format の operationKey。無い操作は「取り消せる」として扱う */
  states: Map<string, OperationStateInfo | MaintenanceOperationState>;
  /** 取り消しを妨げている操作（無ければ空配列） */
  blockersOf: (target: UndoTarget) => BlockingOperation[];
  onUndo: (target: UndoTarget) => void;
  /** 取り消し実行中の操作の operationKey */
  undoingKey?: string | null;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** 読めなかった実行の数 */
  unreadableCount?: number;
  /** 指定すると、そのページが関わる操作だけを出す */
  filterWikiId?: string;
  onOpenPage?: (wikiId: string) => void;
  emptyText?: string;
};

function touches(op: MaintenanceOperation, wikiId: string): boolean {
  return (
    op.subject?.wikiId === wikiId ||
    op.related.some((r) => r.wikiId === wikiId) ||
    op.pages.some((p) => p.wikiId === wikiId) ||
    op.flags.some((f) => f.wikiId === wikiId)
  );
}

export function MaintenanceRunList({
  runs,
  states,
  blockersOf,
  onUndo,
  undoingKey,
  loading,
  hasMore,
  onLoadMore,
  unreadableCount = 0,
  filterWikiId,
  onOpenPage,
  emptyText,
}: MaintenanceRunListProps) {
  const t = useT();

  const visible = runs
    .map((run) => ({
      run,
      ops: filterWikiId ? run.operations.filter((o) => touches(o, filterWikiId)) : run.operations,
    }))
    .filter((v) => v.ops.length > 0);

  const renderRow = (run: MaintenanceRun, op: MaintenanceOperation) => {
    const key = operationKey(run.id, op.id);
    const raw = states.get(key);
    const state = (typeof raw === "string" ? raw : raw?.state) ?? "applied";
    const target: UndoTarget = { runId: run.id, operationId: op.id };
    // 取り消せる状態のときだけ、妨げている操作を調べる
    const blockers =
      state === "applied" || state === "undo_partial" || state === "interrupted" ? blockersOf(target) : [];
    return (
      <MaintenanceOperationRow
        key={op.id}
        operation={op}
        state={state}
        blockedByName={blockers.length > 0 ? operationSentence(blockers[0].op, t) : undefined}
        onUndo={() => onUndo(target)}
        undoing={undoingKey === key}
        onOpenPage={onOpenPage}
      />
    );
  };

  const empty = visible.length === 0 && !loading;

  return (
    <div className="flex flex-col gap-2">
      {visible.map(({ run, ops }) =>
        ops.length > 1 ? (
          <section
            key={run.id}
            aria-label={t(`maintenance.trigger.${run.trigger}`)}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t(`maintenance.trigger.${run.trigger}`)}</span>
              <span>· {t("maintenance.run.operationCount", { count: String(ops.length) })}</span>
              <span className="ml-auto shrink-0">{formatDateTime(run.startedAt)}</span>
            </div>
            <div className="flex flex-col gap-1.5 border-l border-border-subtle pl-2">
              {ops.map((op) => renderRow(run, op))}
            </div>
          </section>
        ) : (
          renderRow(run, ops[0])
        ),
      )}

      {loading && (
        <div role="status" className="flex items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          {t("maintenance.list.loading")}
        </div>
      )}

      {empty && (
        <p className="px-0.5 py-2 text-xs text-muted-foreground">
          {emptyText ?? t(
            filterWikiId
              ? hasMore
                ? "maintenance.list.emptyForPageSoFar"
                : "maintenance.list.emptyForPage"
              : "maintenance.list.empty",
          )}
        </p>
      )}

      {unreadableCount > 0 && (
        <p className="px-0.5 text-xs text-muted-foreground">
          {t("maintenance.list.unreadable", { count: String(unreadableCount) })}
        </p>
      )}

      {hasMore && onLoadMore && (
        <button
          type="button"
          disabled={loading}
          className="self-start rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring disabled:text-text-tertiary"
          onClick={onLoadMore}
        >
          {t("maintenance.list.loadMore")}
        </button>
      )}
    </div>
  );
}
