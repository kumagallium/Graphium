// Wiki Lint 結果表示ビュー
// 整合性チェックの結果を種別・重要度別に表示する

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unlink,
  Lightbulb,
  Clock,
} from "lucide-react";
import type { LintReport, LintIssue, LintIssueType, LintSeverity } from "../../server/services/wiki-linter";

type Props = {
  report: LintReport | null;
  loading: boolean;
  onRunLint: (localOnly: boolean) => void;
  onOpenWiki: (wikiId: string) => void;
  onBack: () => void;
};

const ISSUE_ICONS: Record<LintIssueType, typeof AlertTriangle> = {
  contradiction: ShieldAlert,
  orphan: Unlink,
  gap: Lightbulb,
  stale: Clock,
};

const ISSUE_LABELS: Record<LintIssueType, string> = {
  contradiction: "Contradiction",
  orphan: "Orphan",
  gap: "Gap",
  stale: "Stale",
};

const SEVERITY_STYLES: Record<LintSeverity, string> = {
  error: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/40",
  warning: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900/40",
  info: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-900/40",
};

export function WikiLintView({ report, loading, onRunLint, onOpenWiki, onBack }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full">
      {/* ヘッダー */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Wiki Health Check</h2>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => onRunLint(false)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? "Analyzing..." : "Run Check"}
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto">
        {!report && !loading && (
          <div className="flex flex-col items-center justify-center h-48 text-xs text-muted-foreground gap-3">
            <AlertTriangle size={28} className="opacity-30" />
            <p>Run a health check to analyze your Wiki for issues</p>
            <div className="flex gap-2">
              <button
                onClick={() => onRunLint(true)}
                className="rounded px-3 py-1.5 text-xs border border-border hover:bg-muted transition-colors"
              >
                Quick (local only)
              </button>
              <button
                onClick={() => onRunLint(false)}
                className="rounded px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Full (AI analysis)
              </button>
            </div>
          </div>
        )}

        {loading && !report && (
          <div className="flex flex-col items-center justify-center h-48 text-xs text-muted-foreground gap-2">
            <Loader2 size={24} className="animate-spin text-primary" />
            <p>Analyzing Wiki health...</p>
          </div>
        )}

        {report && (
          <>
            {/* サマリー */}
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2 mb-2">
                {report.issues.length === 0 ? (
                  <>
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      No issues found
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} className="text-amber-500" />
                    <span className="text-xs font-medium text-foreground">
                      {report.summary.total} issue(s) found
                    </span>
                  </>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {new Date(report.analyzedAt).toLocaleString()}
                </span>
              </div>
              {report.issues.length > 0 && (
                <div className="flex gap-3 text-[10px] text-muted-foreground">
                  {report.summary.contradictions > 0 && (
                    <span className="flex items-center gap-1">
                      <ShieldAlert size={10} className="text-red-500" />
                      {report.summary.contradictions}
                    </span>
                  )}
                  {report.summary.orphans > 0 && (
                    <span className="flex items-center gap-1">
                      <Unlink size={10} className="text-amber-500" />
                      {report.summary.orphans}
                    </span>
                  )}
                  {report.summary.gaps > 0 && (
                    <span className="flex items-center gap-1">
                      <Lightbulb size={10} className="text-blue-500" />
                      {report.summary.gaps}
                    </span>
                  )}
                  {report.summary.stale > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} className="text-amber-500" />
                      {report.summary.stale}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Issue リスト */}
            <div className="divide-y divide-border">
              {report.issues.map((issue, idx) => (
                <IssueCard
                  key={idx}
                  issue={issue}
                  expanded={expandedId === idx}
                  onToggle={() => setExpandedId(expandedId === idx ? null : idx)}
                  onOpenWiki={onOpenWiki}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IssueCard({
  issue,
  expanded,
  onToggle,
  onOpenWiki,
}: {
  issue: LintIssue;
  expanded: boolean;
  onToggle: () => void;
  onOpenWiki: (wikiId: string) => void;
}) {
  const Icon = ISSUE_ICONS[issue.type];
  const label = ISSUE_LABELS[issue.type];
  const style = SEVERITY_STYLES[issue.severity];

  return (
    <div className="px-4 py-3">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium border ${style}`}>
            <Icon size={10} />
            {label}
          </span>
          <span className="text-xs font-medium text-foreground flex-1">{issue.title}</span>
          <Info size={12} className="text-muted-foreground mt-0.5 shrink-0" />
        </div>
      </button>

      {expanded && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-border space-y-2">
          <p className="text-xs text-muted-foreground">{issue.description}</p>
          {issue.suggestion && (
            <div className="text-xs text-foreground/80 bg-muted/50 rounded px-2 py-1.5">
              <span className="font-medium">Suggestion: </span>
              {issue.suggestion}
            </div>
          )}
          {issue.affectedWikiIds.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {issue.affectedWikiIds.map((id) => (
                <button
                  key={id}
                  onClick={() => onOpenWiki(id)}
                  className="text-[10px] text-primary hover:underline"
                >
                  Open: {id.slice(0, 12)}...
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
