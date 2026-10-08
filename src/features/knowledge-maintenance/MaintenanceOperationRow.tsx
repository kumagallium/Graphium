// 保守の操作の 1 行（最小単位）。
//
// 見た目は SnapshotRow（版の行）と WikiLogView の行に合わせる:
//   - 行の枠・文字サイズ・時刻の書式は SnapshotRow と同じ
//   - 種別のアイコンは WikiLogView の EVENT_ICONS と同じもの
//   - 状態の印は「小さな丸いチップ（アイコン + 文字）」。色だけで伝えない
// 画面の組み込みは別段（Storybook で合意してから）。

import type { ReactNode } from "react";
import { AlertTriangle, Archive, GitMerge, Loader2, RefreshCw, RotateCcw, Undo2 } from "lucide-react";
import { useT } from "../../i18n";
import { formatDateTime } from "../version-snapshots/SnapshotRow";
import { describeOperation } from "./summary";
import type { MaintenanceOperation, MaintenanceOperationKind, MaintenanceOperationState } from "./types";

type TFn = ReturnType<typeof useT>;

const KIND_ICONS: Record<MaintenanceOperationKind, typeof Undo2> = {
  merge_topics: GitMerge,
  merge_atoms: GitMerge,
  regenerate: RefreshCw,
  archive: Archive,
  restore_version: RotateCcw,
  undo: Undo2,
};

/** describeOperation の params（数値）を t() に渡せる文字列にそろえる */
function toStringParams(params: Record<string, string | number>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]));
}

/** 操作の 1 行の文 */
export function operationSentence(op: MaintenanceOperation, t: TFn): string {
  const d = describeOperation(op);
  return t(d.key, toStringParams(d.params));
}

/** 「先に『…』を取り消してください」に入れる短い名前。主対象のタイトル、無ければ文そのもの */
export function operationShortName(op: MaintenanceOperation, t: TFn): string {
  return op.subject?.title || operationSentence(op, t);
}

/** タイトルを押して開けるページ（主対象。1 件のアーカイブはそのページ） */
function openablePage(op: MaintenanceOperation): string | undefined {
  if (op.kind === "archive") {
    const archived = op.related.filter((r) => r.role === "archived");
    return archived.length === 1 ? archived[0].wikiId : undefined;
  }
  return op.subject?.wikiId;
}

export type MaintenanceOperationRowProps = {
  operation: MaintenanceOperation;
  state: MaintenanceOperationState;
  /** 先に取り消す必要がある操作の表示名（あるときボタンは押せない） */
  blockedByName?: string;
  onUndo?: () => void;
  /** この操作の取り消しを実行中 */
  undoing?: boolean;
  /** タイトルを押したとき、そのページを開く（任意） */
  onOpenPage?: (wikiId: string) => void;
  /**
   * 誰が頼んだ操作かの短い印（「MCP (claude-desktop)」など）。
   * Graphium の画面から行った操作では出さない（無印 = 自分で行った）
   */
  actorLabel?: string;
};

export function MaintenanceOperationRow({
  operation,
  state,
  blockedByName,
  onUndo,
  undoing,
  onOpenPage,
  actorLabel,
}: MaintenanceOperationRowProps) {
  const t = useT();
  const Icon = KIND_ICONS[operation.kind];
  const sentence = operationSentence(operation, t);

  // タイトルを押せる部分にする。タイトルの位置は、目印の文字を入れて翻訳した文を割って求める
  const pageId = openablePage(operation);
  const d = describeOperation(operation);
  const title = typeof d.params.title === "string" ? d.params.title : "";
  let text: ReactNode = sentence;
  if (onOpenPage && pageId && title) {
    const MARK = "\u0001";
    const parts = t(d.key, toStringParams({ ...d.params, title: MARK })).split(MARK);
    if (parts.length === 2) {
      text = (
        <>
          {parts[0]}
          <button
            type="button"
            data-tooltip={t("maintenance.row.openPage")}
            className="rounded font-medium text-foreground underline decoration-border underline-offset-2 hover:decoration-primary focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onOpenPage(pageId)}
          >
            {title}
          </button>
          {parts[1]}
        </>
      );
    }
  }

  const finished = state === "undone"; // 取り消し済みは控えめに（文字を薄く）
  const blocked = Boolean(blockedByName);
  // ボタンを出すのは、取り消せる・一部だけ済み・途中で止まった操作
  const canShowButton = state === "applied" || state === "undo_partial" || state === "interrupted";
  const reasonId = blocked ? `maint-blocked-${operation.id}` : undefined;
  // 途中で止まった操作のヒントは、title だけでなく読み上げにも届くよう隠し文字でも持つ
  const hintId = state === "interrupted" ? `maint-hint-${operation.id}` : undefined;
  const describedBy = [reasonId, hintId].filter(Boolean).join(" ") || undefined;
  const buttonLabel = undoing
    ? t("maintenance.row.undoing")
    : state === "undo_partial"
      ? t("maintenance.row.undoRetry")
      : t("maintenance.row.undo");

  return (
    <div
      className={[
        "rounded-lg border border-border-subtle bg-card px-2.5 py-2 text-xs",
        finished ? "text-muted-foreground" : "text-foreground",
      ].join(" ")}
    >
      <div className="flex items-start gap-1.5">
        <Icon size={13} className="mt-0.5 shrink-0 text-text-tertiary" aria-hidden />
        <span className="min-w-0 flex-1 break-words leading-relaxed">{text}</span>
        {actorLabel && (
          // 外の AI（MCP）から頼まれた操作の印。書き手が残る規則の、画面側の表れ
          <span
            data-tooltip={t("maintenance.row.viaMcpHint")}
            className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground"
          >
            {actorLabel}
          </span>
        )}
        <span className="shrink-0 text-muted-foreground">{formatDateTime(operation.startedAt)}</span>
      </div>

      {(state !== "applied" || blocked || (canShowButton && onUndo)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {state === "undone" && <StateChip>{t("maintenance.state.undone")}</StateChip>}
          {state === "undo_partial" && (
            <StateChip tone="warning" icon={<AlertTriangle size={11} aria-hidden />}>
              {t("maintenance.state.undo_partial")}
            </StateChip>
          )}
          {state === "interrupted" && (
            <StateChip
              tone="warning"
              icon={<AlertTriangle size={11} aria-hidden />}
              title={t("maintenance.state.interrupted.hint")}
            >
              {t("maintenance.state.interrupted")}
              <span id={hintId} className="sr-only">
                {t("maintenance.state.interrupted.hint")}
              </span>
            </StateChip>
          )}
          {state === "running" && (
            <StateChip icon={<Loader2 size={11} className="animate-spin" aria-hidden />}>
              {t("maintenance.state.running")}
            </StateChip>
          )}
          {blocked && (
            <span id={reasonId} className="text-muted-foreground">
              {t("maintenance.row.blockedBy", { name: blockedByName ?? "" })}
            </span>
          )}
          {canShowButton && onUndo && (
            <button
              type="button"
              disabled={blocked || undoing}
              // 見える文字（ボタン名）を含める。実行中は中身の文字をそのまま名前にする
              aria-label={undoing ? undefined : t("maintenance.row.undoAria", { label: buttonLabel, summary: sentence })}
              aria-describedby={describedBy}
              aria-busy={undoing || undefined}
              className="ml-auto flex items-center gap-1 rounded-lg border border-border-subtle px-2 py-1 text-foreground transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-text-tertiary disabled:hover:bg-transparent"
              onClick={onUndo}
            >
              {undoing ? (
                <Loader2 size={13} className="animate-spin" aria-hidden />
              ) : (
                <Undo2 size={13} aria-hidden />
              )}
              {buttonLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 状態の小さなチップ（SnapshotRow の「AI書き換え前」と同じ作り。警告だけ warning トークン） */
function StateChip({
  children,
  icon,
  tone,
  title,
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "warning";
  title?: string;
}) {
  return (
    <span
      data-tooltip={title}
      className={[
        "flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5",
        tone === "warning"
          ? "border border-warning-border bg-warning-bg text-warning"
          : "bg-muted text-muted-foreground",
      ].join(" ")}
    >
      {icon}
      {children}
    </span>
  );
}
