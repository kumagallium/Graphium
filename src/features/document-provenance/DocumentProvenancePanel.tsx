// ドキュメント来歴パネル
// リビジョン履歴をタイムラインとして表示する
// リビジョンクリックで変更ブロックをハイライト + テキスト差分を展開表示

import { useState } from "react";
import type { DocumentProvenance, RevisionSummary, RevisionEntity, BlockContentDiff } from "./types";
import { useT } from "../../i18n";

type Props = {
  provenance: DocumentProvenance | null | undefined;
  /** リビジョン選択時のコールバック（ブロック ID 一覧） */
  onHighlightBlocks?: (blockIds: string[]) => void;
};

/** テキストを省略表示（長すぎる場合） */
function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

/** 変更サマリを人間が読める形式に変換 */
function formatSummary(summary: RevisionSummary, t: ReturnType<typeof useT>): string[] {
  const parts: string[] = [];
  if (summary.blocksAdded > 0) parts.push(`+${summary.blocksAdded} ${t("history.blocks")}`);
  if (summary.blocksRemoved > 0) parts.push(`-${summary.blocksRemoved} ${t("history.blocks")}`);
  if (summary.blocksModified > 0) parts.push(`~${summary.blocksModified} ${t("history.blocks")}`);
  if (summary.labelsChanged.length > 0) parts.push(`${t("history.labels")}: ${summary.labelsChanged.join(", ")}`);
  if (summary.provLinksAdded > 0) parts.push(`+${summary.provLinksAdded} prov links`);
  if (summary.provLinksRemoved > 0) parts.push(`-${summary.provLinksRemoved} prov links`);
  if (summary.knowledgeLinksAdded > 0) parts.push(`+${summary.knowledgeLinksAdded} knowledge links`);
  if (summary.knowledgeLinksRemoved > 0) parts.push(`-${summary.knowledgeLinksRemoved} knowledge links`);
  return parts;
}

/** タイムスタンプを相対時間で表示 */
function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** 操作種別の表示ラベル */
function activityTypeLabel(type: string, t: ReturnType<typeof useT>): string {
  switch (type) {
    case "human_edit": return t("history.type.edit");
    case "human_derivation": return t("history.type.derive");
    case "ai_generation": return t("history.type.aiGen");
    case "ai_derivation": return t("history.type.aiDerive");
    case "template_create": return t("history.type.template");
    case "derive_source": return t("history.type.deriveSource");
    default: return type;
  }
}

/** RevisionSummary から変更ブロック ID を集約 */
function getChangedBlockIds(summary: RevisionSummary): string[] {
  return [
    ...(summary.addedBlockIds ?? []),
    ...(summary.modifiedBlockIds ?? []),
  ];
}

/** diff type のアイコン・色 */
function diffTypeStyle(type: BlockContentDiff["type"]) {
  switch (type) {
    case "add": return { icon: "+", color: "text-green-600 dark:text-green-400" };
    case "remove": return { icon: "−", color: "text-red-600 dark:text-red-400" };
    case "modify": return { icon: "~", color: "text-blue-600 dark:text-blue-400" };
  }
}

/** テキスト差分の展開表示 */
function ContentDiffView({ diffs }: { diffs: BlockContentDiff[] }) {
  return (
    <div className="mt-1.5 space-y-1 border-t border-border/50 pt-1.5">
      {diffs.map((diff, i) => {
        const { icon, color } = diffTypeStyle(diff.type);
        return (
          <div key={i} className="text-[10px] leading-relaxed">
            <div className="flex items-start gap-1">
              <span className={`font-bold ${color} shrink-0 w-3 text-center`}>{icon}</span>
              <span className="font-mono text-muted-foreground/60 shrink-0">
                {diff.blockId.slice(0, 8)}
              </span>
              <div className="min-w-0 flex-1">
                {diff.type === "modify" && diff.before && (
                  <div className="text-red-600/70 dark:text-red-400/70 line-through break-all">
                    {truncate(diff.before)}
                  </div>
                )}
                {(diff.type === "add" || diff.type === "modify") && diff.after && (
                  <div className={`${diff.type === "add" ? "text-green-600/70 dark:text-green-400/70" : "text-foreground/70"} break-all`}>
                    {truncate(diff.after)}
                  </div>
                )}
                {diff.type === "remove" && diff.before && (
                  <div className="text-red-600/70 dark:text-red-400/70 line-through break-all">
                    {truncate(diff.before)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DocumentProvenancePanel({ provenance, onHighlightBlocks }: Props) {
  const t = useT();
  const [selectedRevId, setSelectedRevId] = useState<string | null>(null);

  if (!provenance || provenance.revisions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        {t("history.empty")}
      </div>
    );
  }

  const reversedRevisions = [...provenance.revisions].reverse();
  const activityMap = new Map(provenance.activities.map((a) => [a.id, a]));
  const agentMap = new Map(provenance.agents.map((a) => [a.id, a]));

  const handleRevisionClick = (revId: string, summary: RevisionSummary) => {
    if (selectedRevId === revId) {
      // 同じリビジョンをクリック → ハイライト解除
      setSelectedRevId(null);
      onHighlightBlocks?.([]);
    } else {
      setSelectedRevId(revId);
      onHighlightBlocks?.(getChangedBlockIds(summary));
    }
  };

  return (
    <div className="p-3 space-y-1">
      <div className="text-xs text-muted-foreground mb-2">
        {provenance.revisions.length} {t("history.revisions")}
      </div>
      {reversedRevisions.map((rev: RevisionEntity) => {
        const activity = activityMap.get(rev.wasGeneratedBy);
        const agent = activity ? agentMap.get(activity.wasAssociatedWith) : null;
        const summaryParts = formatSummary(rev.summary, t);
        const isSelected = selectedRevId === rev.id;
        const hasBlocks = getChangedBlockIds(rev.summary).length > 0;
        const hasDiffs = rev.summary.contentDiff && rev.summary.contentDiff.length > 0;

        return (
          <div
            key={rev.id}
            onClick={() => (hasBlocks || hasDiffs) && handleRevisionClick(rev.id, rev.summary)}
            className={[
              "border rounded px-2.5 py-1.5 text-xs space-y-0.5 transition-colors",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border bg-background",
              hasBlocks || hasDiffs ? "cursor-pointer hover:border-primary/50" : "",
            ].join(" ")}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-muted-foreground">{rev.id}</span>
              <span className="text-muted-foreground">{relativeTime(rev.savedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {activity && (
                <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                  {activityTypeLabel(activity.type, t)}
                </span>
              )}
              {agent && (
                <span className="text-muted-foreground">
                  {agent.type === "ai" ? "AI" : ""} {agent.label}
                  {agent.email && (
                    <span className="ml-1 text-muted-foreground/60">({agent.email})</span>
                  )}
                </span>
              )}
            </div>
            {summaryParts.length > 0 && (
              <div className="text-muted-foreground">
                {summaryParts.join(" | ")}
              </div>
            )}
            {/* テキスト差分の展開表示（選択時） */}
            {isSelected && hasDiffs && (
              <ContentDiffView diffs={rev.summary.contentDiff!} />
            )}
          </div>
        );
      })}
    </div>
  );
}
