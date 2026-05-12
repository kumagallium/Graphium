// Wiki Lint 結果表示ビュー
// 整合性チェックの結果を種別・重要度別に表示する。
// PR-B6 (v1): 検出だけでなく Fix アクション（Regenerate / Archive / Open）も提供。
// AI ナレッジ層では AI が主導権を握ってよいが、実行はユーザーのボタン押下時のみ。

import { useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Copy,
  Info,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unlink,
  Lightbulb,
  Clock,
  Archive as ArchiveIcon,
  ExternalLink,
} from "lucide-react";
import type { LintReport, LintIssue, LintIssueType, LintSeverity } from "../../server/services/wiki-linter";
import { useT } from "../../i18n";

type Props = {
  report: LintReport | null;
  loading: boolean;
  onRunLint: (localOnly: boolean) => void;
  onOpenWiki: (wikiId: string) => void;
  onBack: () => void;
  /** Fix アクション (PR-B6 v1): wiki を再生成する。stale な wiki の代表的な修正。 */
  onRegenerateWiki?: (wikiId: string) => Promise<void> | void;
  /** Fix アクション (PR-B6 v1): wiki をアーカイブする。orphan / 冗長 / 古いものを退避。 */
  onArchiveWiki?: (wikiId: string) => Promise<void> | void;
  /**
   * wikiId → タイトルの解決マップ (PR-B6.2)。
   * UI は UUID を見せず、人間に判断できるタイトルで表示する。
   * 解決できなければ ID 接頭辞にフォールバック。
   */
  wikiTitleById?: Map<string, string>;
};

const ISSUE_ICONS: Record<LintIssueType, typeof AlertTriangle> = {
  contradiction: ShieldAlert,
  orphan: Unlink,
  gap: Lightbulb,
  stale: Clock,
  redundant: Copy,
};

const ISSUE_TYPE_I18N_KEY: Record<LintIssueType, string> = {
  contradiction: "wikiLint.type.contradiction",
  orphan: "wikiLint.type.orphan",
  gap: "wikiLint.type.gap",
  stale: "wikiLint.type.stale",
  redundant: "wikiLint.type.redundant",
};

// 各 issue type で適用可能な fix アクション（PR-B6 v1）
//
// - contradiction: AI が片方を勝手に書き換えると別 issue を生むため Open のみ
// - orphan: 参照されていない → Archive で隠す or Open で手動リンク追加
// - gap: AI による穴埋めは v2 以降 → Open のみ
// - stale: Regenerate（最新 source から再生成）/ Archive / Open
// - redundant: Auto-merge は v2 以降 → Archive で片側を隠す or Open で比較
const FIX_ACTIONS_BY_TYPE: Record<LintIssueType, ReadonlyArray<"open" | "regenerate" | "archive">> = {
  contradiction: ["open"],
  orphan: ["open", "archive"],
  gap: ["open"],
  stale: ["open", "regenerate", "archive"],
  redundant: ["open", "archive"],
};

const SEVERITY_STYLES: Record<LintSeverity, string> = {
  error: "text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950/30 dark:border-red-900/40",
  warning: "text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900/40",
  info: "text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950/30 dark:border-blue-900/40",
};

export function WikiLintView({
  report,
  loading,
  onRunLint,
  onOpenWiki,
  onBack,
  onRegenerateWiki,
  onArchiveWiki,
  wikiTitleById,
}: Props) {
  const t = useT();
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
          <h2 className="text-sm font-semibold text-foreground">{t("wikiLint.header")}</h2>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => onRunLint(false)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? t("wikiLint.analyzingShort") : t("wikiLint.runButton")}
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-y-auto">
        {!report && !loading && (
          <div className="flex flex-col items-center justify-center h-48 text-xs text-muted-foreground gap-3">
            <AlertTriangle size={28} className="opacity-30" />
            <p>{t("wikiLint.emptyHint")}</p>
            <div className="flex gap-2">
              <button
                onClick={() => onRunLint(true)}
                title={t("wikiLint.quickHint")}
                className="rounded px-3 py-1.5 text-xs border border-border hover:bg-muted transition-colors"
              >
                {t("wikiLint.quickButton")}
              </button>
              <button
                onClick={() => onRunLint(false)}
                title={t("wikiLint.fullHint")}
                className="rounded px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t("wikiLint.fullButton")}
              </button>
            </div>
          </div>
        )}

        {loading && !report && (
          <div className="flex flex-col items-center justify-center h-48 text-xs text-muted-foreground gap-2">
            <Loader2 size={24} className="animate-spin text-primary" />
            <p>{t("wikiLint.analyzingLong")}</p>
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
                      {t("wikiLint.noIssues")}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={14} className="text-amber-500" />
                    <span className="text-xs font-medium text-foreground">
                      {t("wikiLint.issuesFound", { count: String(report.summary.total) })}
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
                  {report.summary.redundant > 0 && (
                    <span className="flex items-center gap-1">
                      <Copy size={10} className="text-amber-500" />
                      {report.summary.redundant}
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
                  onRegenerateWiki={onRegenerateWiki}
                  onArchiveWiki={onArchiveWiki}
                  wikiTitleById={wikiTitleById}
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
  onRegenerateWiki,
  onArchiveWiki,
  wikiTitleById,
}: {
  issue: LintIssue;
  expanded: boolean;
  onToggle: () => void;
  onOpenWiki: (wikiId: string) => void;
  onRegenerateWiki?: (wikiId: string) => Promise<void> | void;
  onArchiveWiki?: (wikiId: string) => Promise<void> | void;
  wikiTitleById?: Map<string, string>;
}) {
  const t = useT();
  const Icon = ISSUE_ICONS[issue.type];
  const label = t(ISSUE_TYPE_I18N_KEY[issue.type] as any);
  const style = SEVERITY_STYLES[issue.severity];
  // 各 wiki ごとに「実行中アクション」を持つ（同時並行で同じ wiki に別アクションが走らないように）
  const [pendingByWiki, setPendingByWiki] = useState<Record<string, "regenerate" | "archive" | null>>({});
  // 本セッションで archive 済みの wiki を覚えておく。redundant では「全部消す」のを防ぐためのガード。
  const [archivedThisSession, setArchivedThisSession] = useState<Set<string>>(new Set());

  const availableActions = FIX_ACTIONS_BY_TYPE[issue.type] ?? ["open"];
  const hasRegenerate = availableActions.includes("regenerate") && Boolean(onRegenerateWiki);
  const hasArchive = availableActions.includes("archive") && Boolean(onArchiveWiki);

  // Redundant ガード: 統合候補をすべてアーカイブできてしまうと知識が消失するため、
  // 「残り 1 件以下」になる手前で Archive を無効化する。
  const isRedundant = issue.type === "redundant";
  const remainingCount = issue.affectedWikiIds.filter((id) => !archivedThisSession.has(id)).length;
  const redundantGuardActive = isRedundant && remainingCount <= 1;

  const runAction = async (
    wikiId: string,
    action: "regenerate" | "archive",
  ) => {
    if (pendingByWiki[wikiId]) return;
    // 確認ダイアログ。i18n 文の {title} 補間用のヒントは issue.title or wikiId 接頭辞。
    const titleHint = issue.title || wikiId.slice(0, 12);
    const message =
      action === "archive"
        ? t("wikiLint.action.confirmArchive", { title: titleHint })
        : t("wikiLint.action.confirmRegenerate", { title: titleHint });
    if (!window.confirm(message)) return;
    setPendingByWiki((p) => ({ ...p, [wikiId]: action }));
    try {
      if (action === "regenerate") await onRegenerateWiki?.(wikiId);
      else {
        await onArchiveWiki?.(wikiId);
        setArchivedThisSession((prev) => {
          const next = new Set(prev);
          next.add(wikiId);
          return next;
        });
      }
    } catch (err) {
      console.error("Lint fix action failed:", err);
    } finally {
      setPendingByWiki((p) => ({ ...p, [wikiId]: null }));
    }
  };

  const recommended = issue.recommendedAction;

  // wikiId からタイトルを解決。無ければ ID 接頭辞で fallback。
  const resolveTitle = (id: string): string => {
    const t = wikiTitleById?.get(id);
    if (t && t.trim()) return t;
    return `${id.slice(0, 8)}…`;
  };

  return (
    <div className="px-4 py-3">
      <button onClick={onToggle} className="w-full text-left">
        <div className="flex items-start gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${style}`}>
            <Icon size={12} />
            {label}
          </span>
          <span className="text-sm font-medium text-foreground flex-1">{issue.title}</span>
          <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
        </div>
      </button>

      {expanded && (
        <div className="mt-2 ml-1 pl-3 border-l-2 border-border space-y-2">
          <p className="text-sm text-muted-foreground">{issue.description}</p>
          {issue.suggestion && (
            <div className="text-sm text-foreground/80 bg-muted/50 rounded px-2 py-1.5">
              <span className="font-medium">{t("wikiLint.suggestionPrefix")}</span>
              {issue.suggestion}
            </div>
          )}
          {recommended?.type === "merge" && recommended.reason && (
            <div className="text-xs text-primary/90 bg-primary/5 rounded px-2 py-1.5 border border-primary/20">
              <span className="font-medium">{t("wikiLint.action.recommendedPrefix")}</span>
              {recommended.reason}
            </div>
          )}
          {issue.affectedWikiIds.length > 0 && (
            <div className="space-y-1.5">
              {issue.affectedWikiIds.map((id) => {
                const pending = pendingByWiki[id];
                const alreadyArchived = archivedThisSession.has(id);
                // 「冗長」の場合: 残り 1 件以下では Archive ボタンを無効化（知識消失防止）
                const archiveDisabledByGuard = hasArchive && redundantGuardActive && !alreadyArchived;
                const isRecommendedKeep = recommended?.type === "merge" && recommended.keepId === id;
                const isRecommendedAbsorb = recommended?.type === "merge" && recommended.absorbId === id;
                return (
                  <div key={id} className="flex items-center gap-2 flex-wrap text-xs">
                    {isRecommendedKeep && (
                      <span
                        title={t("wikiLint.action.keeperHint")}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 bg-success-bg text-success border border-success-border font-medium"
                      >
                        ✓ {t("wikiLint.action.keeperBadge")}
                      </span>
                    )}
                    <span
                      title={id}
                      className={`flex-1 min-w-0 truncate ${alreadyArchived ? "text-muted-foreground/50 line-through" : "text-foreground"}`}
                    >
                      {resolveTitle(id)}
                    </span>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => onOpenWiki(id)}
                        disabled={Boolean(pending)}
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-border bg-background text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      >
                        <ExternalLink size={12} />
                        {t("wikiLint.action.open")}
                      </button>
                      {hasRegenerate && !alreadyArchived && !isRecommendedAbsorb && (
                        <button
                          onClick={() => runAction(id, "regenerate")}
                          disabled={Boolean(pending)}
                          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs border border-primary/50 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
                        >
                          {pending === "regenerate" ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              {t("wikiLint.action.running")}
                            </>
                          ) : (
                            <>
                              <RefreshCw size={12} />
                              {t("wikiLint.action.regenerate")}
                            </>
                          )}
                        </button>
                      )}
                      {hasArchive && !alreadyArchived && !isRecommendedKeep && (
                        <button
                          onClick={() => runAction(id, "archive")}
                          disabled={Boolean(pending) || archiveDisabledByGuard}
                          title={archiveDisabledByGuard ? t("wikiLint.action.redundantGuardHint") : undefined}
                          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                            isRecommendedAbsorb
                              ? "border border-warning-border text-warning bg-warning-bg hover:bg-warning-bg/70 font-medium"
                              : "border border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {pending === "archive" ? (
                            <>
                              <Loader2 size={12} className="animate-spin" />
                              {t("wikiLint.action.running")}
                            </>
                          ) : (
                            <>
                              <ArchiveIcon size={12} />
                              {isRecommendedAbsorb ? t("wikiLint.action.archiveRecommended") : t("wikiLint.action.archive")}
                            </>
                          )}
                        </button>
                      )}
                      {alreadyArchived && (
                        <span className="text-xs text-muted-foreground/60 italic">
                          {t("wikiLint.action.archivedBadge")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
