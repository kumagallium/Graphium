// ドキュメント来歴パネル
// リビジョン履歴をタイムラインとして表示する

import type { DocumentProvenance, RevisionSummary } from "./types";
import { useT } from "../../i18n";

type Props = {
  provenance: DocumentProvenance | null | undefined;
};

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
function activityTypeLabel(type: string): string {
  switch (type) {
    case "human_edit": return "Edit";
    case "ai_generation": return "AI Gen";
    case "ai_derivation": return "AI Derive";
    case "template_create": return "Template";
    default: return type;
  }
}

export function DocumentProvenancePanel({ provenance }: Props) {
  const t = useT();

  if (!provenance || provenance.revisions.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
        {t("history.empty")}
      </div>
    );
  }

  // 新しい順に表示
  const reversedRevisions = [...provenance.revisions].reverse();
  const activityMap = new Map(provenance.activities.map((a) => [a.id, a]));
  const agentMap = new Map(provenance.agents.map((a) => [a.id, a]));

  return (
    <div className="p-3 space-y-1">
      <div className="text-xs text-muted-foreground mb-2">
        {provenance.revisions.length} {t("history.revisions")}
      </div>
      {reversedRevisions.map((rev) => {
        const activity = activityMap.get(rev.wasGeneratedBy);
        const agent = activity ? agentMap.get(activity.wasAssociatedWith) : null;
        const summaryParts = formatSummary(rev.summary, t);

        return (
          <div
            key={rev.id}
            className="border border-border rounded px-2.5 py-1.5 text-xs space-y-0.5 bg-background"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-muted-foreground">{rev.id}</span>
              <span className="text-muted-foreground">{relativeTime(rev.savedAt)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {activity && (
                <span className="px-1 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary">
                  {activityTypeLabel(activity.type)}
                </span>
              )}
              {agent && (
                <span className="text-muted-foreground">
                  {agent.type === "ai" ? "AI" : ""} {agent.label}
                </span>
              )}
            </div>
            {summaryParts.length > 0 && (
              <div className="text-muted-foreground">
                {summaryParts.join(" | ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
