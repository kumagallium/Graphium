// ノートのヘッダに出す「変更の提案」の状態バッジ（§25 C-4）。
// NoteSharedCommentsBadge と同型: 共有ストアを購読して、封筒から状態を導出して 1 行で出す。
//
// なぜ封筒から毎回導出するか:
//   状態を提案の封筒に書くと、書けるのは提案者だけなのに「取り込んだ」と言えるのは
//   元の作者だけ、という食い違いが起きる。元エントリの hash と取り込み記録
//   （8b で作者が書く extra.adoptedProposals）から毎回導出する（proposalStatus）。

import { useMemo } from "react";
import { GitPullRequestArrow } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n";
import type { SharedEntry } from "../../lib/storage/shared";
import { useSharedLibrary } from "./shared-library-store";
import { proposalStatus, type ProposalStatus } from "./share-proposal";

/** 状態ごとの色。取り込み済み＝落ち着いた緑、元が更新＝注意の琥珀、見つからない＝薄い灰 */
const STATUS_CLASS: Record<ProposalStatus, string> = {
  open: "bg-primary/10 text-primary",
  adopted: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  stale: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  missing: "text-muted-foreground",
};

/** 状態ラベル（短い表示用）と、その説明（ツールチップ用）の i18n キー */
export function proposalStatusLabelKey(status: ProposalStatus): string {
  return `proposal.status.${status}`;
}
export function proposalStatusHintKey(status: ProposalStatus): string {
  return `proposal.status.${status}Hint`;
}

export function NoteProposalStatusBadge({
  proposalId,
  onClick,
  entries,
}: {
  /** 手元ノートの sharedRef.id（type === "proposal" のときだけ渡す） */
  proposalId: string;
  onClick?: () => void;
  /** DI: 共有エントリ一覧（既定は共有ストア）。Storybook / テスト用 */
  entries?: readonly SharedEntry[];
}) {
  const t = useT();
  const snapshot = useSharedLibrary();
  const all = entries ?? snapshot.entries;
  const status = useMemo<ProposalStatus | null>(() => {
    const proposal = all.find((e) => e.id === proposalId && e.type === "proposal");
    // まだ読み込めていない間は何も出さない（「見つかりません」と言い切らない）
    if (!proposal) return null;
    return proposalStatus(proposal, null, all);
  }, [all, proposalId]);
  if (!status) return null;

  const label = t(proposalStatusLabelKey(status));
  return (
    <button
      type="button"
      onClick={onClick}
      title={t(proposalStatusHintKey(status))}
      data-testid="note-proposal-status"
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded-md shrink-0 inline-flex items-center gap-1 transition-colors max-w-[220px]",
        STATUS_CLASS[status],
        onClick ? "cursor-pointer hover:opacity-80" : "cursor-default",
      )}
    >
      <GitPullRequestArrow size={10} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
