// チャットの回答の下に出す「修正案」のカード
//
// AI が書き換えの道具（propose_edit）を呼ぶと、その場では書き換えず、回答の下に
// ブロックごとの前後の差分を並べる。利用者が「反映」を押したときだけ保存する。
// - 1 枚 = 1 つの対象（ノート・スキル）。中に変更（置き換え・追加・削除）を並べる
// - 状態: 未決 → 反映済み / やめた / 古い（案を出した後に本文が変わった）/ 失敗
// - 「すべて反映」は未決の変更だけをまとめて反映する

import { Check, FileText, Sparkles, Undo2, X } from "lucide-react";
import { useT } from "../../../i18n";
import type { ChatEditChange, ChatEditProposal } from "../../../lib/document-types";

/** busy = サイドピーク・別ウィンドウの未保存の編集を書き出せず、書かなかった。もう一度押せる */
export type EditProposalStatus = "pending" | "applied" | "declined" | "stale" | "failed" | "busy";

/** 表示用: 変更に今の状態を添えたもの */
type EditProposalChange = ChatEditChange & { status: EditProposalStatus };

export type EditProposalCardProps = {
  proposal: ChatEditProposal;
  /** 変更 ID → 今の状態（無い変更は未決） */
  statuses: Readonly<Record<string, EditProposalStatus>>;
  onApply: (changeIds: string[]) => void;
  onDecline: (changeIds: string[]) => void;
  /** 反映済みの変更を元に戻す（反映した直後だけ出す） */
  onUndo?: (changeIds: string[]) => void;
  /** 対象を開く */
  onOpenTarget?: () => void;
  /** 反映中（ボタンを止める） */
  busy?: boolean;
};

export function EditProposalCard({ proposal: stored, statuses, onApply, onDecline, onUndo, onOpenTarget, busy }: EditProposalCardProps) {
  const t = useT();
  const proposal = {
    ...stored,
    changes: stored.changes.map((c): EditProposalChange => ({ ...c, status: statuses[c.id] ?? "pending" })),
  };
  const pendingIds = proposal.changes.filter((c) => c.status === "pending" || c.status === "busy").map((c) => c.id);
  const appliedIds = proposal.changes.filter((c) => c.status === "applied").map((c) => c.id);
  const Icon = proposal.target.kind === "skill" ? Sparkles : FileText;

  return (
    <section
      className="rounded-xl border border-border bg-card text-sm shadow-sm"
      aria-label={t("editProposal.aria", { title: proposal.target.title })}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {t(proposal.target.kind === "skill" ? "editProposal.kindSkill" : "editProposal.kindNote")}
        </span>
        <button
          type="button"
          className="min-w-0 truncate font-medium text-foreground hover:underline disabled:no-underline"
          onClick={onOpenTarget}
          disabled={!onOpenTarget}
          title={proposal.target.title}
        >
          {proposal.target.title}
        </button>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {t("editProposal.count", { count: String(proposal.changes.length) })}
        </span>
      </header>

      {proposal.reason && <p className="px-3 pt-2 text-xs text-muted-foreground">{proposal.reason}</p>}

      <ol className="space-y-2 px-3 py-2">
        {proposal.changes.map((c) => (
          <li key={c.id}>
            <ChangeRow change={c} busy={busy} onApply={() => onApply([c.id])} onDecline={() => onDecline([c.id])} />
          </li>
        ))}
      </ol>

      {(pendingIds.length > 1 || (appliedIds.length > 0 && onUndo)) && (
        <footer className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          {appliedIds.length > 0 && onUndo && (
            <button
              type="button"
              className="mr-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onUndo(appliedIds)}
              disabled={busy}
            >
              <Undo2 size={12} aria-hidden />
              {t("editProposal.undo")}
            </button>
          )}
          {pendingIds.length > 1 && (
            <>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => onDecline(pendingIds)}
                disabled={busy}
              >
                {t("editProposal.declineAll")}
              </button>
              <button
                type="button"
                className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
                onClick={() => onApply(pendingIds)}
                disabled={busy}
              >
                {t("editProposal.applyAll", { count: String(pendingIds.length) })}
              </button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}

function ChangeRow({
  change,
  busy,
  onApply,
  onDecline,
}: {
  change: EditProposalChange;
  busy?: boolean;
  onApply: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  const opLabel = t(
    change.op === "replace" ? "editProposal.opReplace" : change.op === "insert" ? "editProposal.opInsert" : "editProposal.opDelete",
  );
  const settled = change.status !== "pending" && change.status !== "busy";

  return (
    <div className={`rounded-md border border-border ${settled ? "opacity-70" : ""}`}>
      <div className="flex items-center gap-2 px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">{opLabel}</span>
        <span className="ml-auto">
          <StatusOrActions status={change.status} busy={busy} onApply={onApply} onDecline={onDecline} />
        </span>
      </div>
      {change.status === "busy" && (
        <p className="px-2 pb-1 text-xs text-amber-700 dark:text-amber-400">{t("editProposal.statusBusy")}</p>
      )}
      {change.op !== "insert" && change.before !== undefined && (
        <Block tone="before" label={t("editProposal.before")} text={change.before} strike={change.op === "delete"} />
      )}
      {change.op === "insert" && change.before !== undefined && (
        <p className="truncate px-2 pb-1 text-xs text-muted-foreground" title={change.before}>
          {t("editProposal.insertAfter", { text: oneLine(change.before) })}
        </p>
      )}
      {change.op !== "delete" && change.after !== undefined && (
        <Block tone="after" label={t("editProposal.after")} text={change.after} />
      )}
    </div>
  );
}

function StatusOrActions({
  status,
  busy,
  onApply,
  onDecline,
}: {
  status: EditProposalStatus;
  busy?: boolean;
  onApply: () => void;
  onDecline: () => void;
}) {
  const t = useT();
  if (status === "pending" || status === "busy") {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
          onClick={onDecline}
          disabled={busy}
        >
          <X size={12} aria-hidden />
          {t("editProposal.decline")}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 rounded-md bg-primary px-1.5 py-0.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50"
          onClick={onApply}
          disabled={busy}
        >
          <Check size={12} aria-hidden />
          {t("editProposal.apply")}
        </button>
      </span>
    );
  }
  const key =
    status === "applied"
      ? "editProposal.statusApplied"
      : status === "declined"
        ? "editProposal.statusDeclined"
        : status === "stale"
          ? "editProposal.statusStale"
          : "editProposal.statusFailed";
  const tone = status === "stale" || status === "failed" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground";
  return <span className={`text-xs ${tone}`}>{t(key)}</span>;
}

function Block({ tone, label, text, strike }: { tone: "before" | "after"; label: string; text: string; strike?: boolean }) {
  // 前は赤み、後は緑みの薄い地。色だけに頼らないよう、左に「前」「後」の字を置く
  const bg = tone === "before" ? "bg-red-50 dark:bg-red-950/30" : "bg-emerald-50 dark:bg-emerald-950/30";
  return (
    <div className={`flex gap-2 px-2 py-1.5 ${bg}`}>
      <span className="w-6 shrink-0 pt-px text-[11px] text-muted-foreground">{label}</span>
      <p className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-xs text-foreground ${strike ? "line-through" : ""}`}>{text}</p>
    </div>
  );
}

function oneLine(s: string): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > 40 ? `${line.slice(0, 40)}…` : line;
}
