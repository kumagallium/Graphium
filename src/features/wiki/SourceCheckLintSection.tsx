// 出典照合（Source check, v1.1）のタブ内容。
//
// WikiLintView の「出典照合」タブに置く別レーンの機能（既存の「クイック / フル」点検とは
// 別）。自動点検（ingest 直後・起動時）には一切つながない — ここに置いたボタンからしか走らない。
// ビジネスロジック（対象の読み込み・plan/run/save）は useSourceCheck フック（呼び出し側）に
// 委ね、この部品は UI 状態（選択・計画のプレビュー）だけを持つ。
//
// レイアウトは既存の点検タブの開始画面（中央揃え）に合わせる。対象・範囲の選択 → 計画の
// 件数 → 実行/やめる → 進捗・中断 → 結果の件数、のどの段階も中央揃えの 1 カラムにする。
//
// 実行中かどうか・進捗・直近の完了結果は useSourceCheck フックの state
// （batchRunning / batchProgress / batchResult）を props で受け取って表示する。
// ローカル state に置くと、この欄がアンマウントされる（タブを切り替える・画面を離れる）だけで
// 実行中の進捗・完了結果が消えてしまうため（フックは note-app 側で保持され続ける）。

import { useState } from "react";
import { FileSearch, Loader2, X } from "lucide-react";
import type { SourceCheckProfile } from "../../lib/document-types";
import { useT } from "../../i18n";
import type {
  BatchRunResult,
  LintPlanResult,
  SourceCheckScope,
  SourceCheckTargetKind,
} from "../source-check/use-source-check";
import { SourceCheckReviewList, type SourceCheckReviewListProps } from "../source-check/ui/SourceCheckReviewList";

export type SourceCheckLintSectionProps = {
  /** 対象・範囲から計画を組み立てる（対象ドキュメントを実際に読み込むため非同期）。 */
  onPlan: (target: SourceCheckTargetKind, scope: SourceCheckScope) => Promise<LintPlanResult>;
  /** 計画を実行して保存する（進捗・完了は running/progress/result props 経由で受け取る）。 */
  onRun: (plan: LintPlanResult) => Promise<BatchRunResult>;
  /** 実行中の中断（AbortController.abort 相当）。 */
  onCancel: () => void;
  /** 一括実行が進行中か（useSourceCheck.batchRunning）。 */
  running: boolean;
  /** 実行中の進捗（useSourceCheck.batchProgress）。 */
  progress: { index: number; total: number } | null;
  /** 直近の完了結果（useSourceCheck.batchResult）。running が false のときだけ意味を持つ。 */
  result: BatchRunResult | null;
  /** 完了表示を閉じて次の計画に戻る（useSourceCheck.resetBatchResult）。 */
  onDismissResult: () => void;
  /**
   * 「要確認」一覧（仕様: AI の判定で一覧から自動的に隠さない代わりに常設の別リストで目立たせる）。
   * 0 件のときは一覧自体を出さない（開始画面だけ）。未指定でも一覧を出さない。
   */
  reviewList?: SourceCheckReviewListProps;
};

type LocalPhase =
  | { status: "idle" }
  | { status: "planning" }
  | { status: "planned"; plan: LintPlanResult };

export function SourceCheckLintSection({
  onPlan,
  onRun,
  onCancel,
  running,
  progress,
  result,
  onDismissResult,
  reviewList,
}: SourceCheckLintSectionProps) {
  const t = useT();
  const [target, setTarget] = useState<SourceCheckTargetKind>("both");
  const [scope, setScope] = useState<SourceCheckScope>("unchecked");
  const [phase, setPhase] = useState<LocalPhase>({ status: "idle" });

  const handlePlan = async () => {
    setPhase({ status: "planning" });
    try {
      const plan = await onPlan(target, scope);
      setPhase({ status: "planned", plan });
    } catch (err) {
      console.error("Source check plan failed:", err);
      setPhase({ status: "idle" });
    }
  };

  const handleConfirmRun = async (plan: LintPlanResult) => {
    try {
      await onRun(plan);
      setPhase({ status: "idle" });
    } catch (err) {
      console.error("Source check run failed:", err);
      setPhase({ status: "idle" });
    }
  };

  const missingSummary = (plan: LintPlanResult) =>
    Object.entries(plan.plan.missingCounts)
      .map(([reason, count]) => `${t(`sourceCheck.missingReason.${reason}` as never)} ${count}`)
      .join(" / ");

  const verdictSummary = (result: BatchRunResult) => {
    const counts: Partial<Record<SourceCheckProfile["verdict"], number>> = {};
    for (const profile of result.profiles.values()) {
      counts[profile.verdict] = (counts[profile.verdict] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([verdict, count]) => `${t(`sourceCheck.verdict.${verdict}` as never)} ${count}`)
      .join(" / ");
  };

  // running / result（フック state）を最優先で見る。画面を離れて戻っても
  // 実行中なら進捗、完了していれば結果がそのまま出る。
  const showRunning = running;
  const showResult = !running && result !== null;
  const showLocal = !showRunning && !showResult;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col items-center justify-center h-48 text-xs text-muted-foreground gap-3 px-4 text-center">
        <FileSearch size={28} className="opacity-30" />
        <p className="max-w-sm">{t("wikiLint.sourceCheck.help")}</p>

        {showLocal && (phase.status === "idle" || phase.status === "planning") && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as SourceCheckTargetKind)}
              disabled={phase.status === "planning"}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
              aria-label={t("wikiLint.sourceCheck.targetLabel")}
            >
              <option value="both">{t("wikiLint.sourceCheck.targetBoth")}</option>
              <option value="claim">{t("wikiLint.sourceCheck.targetClaim")}</option>
              <option value="topic">{t("wikiLint.sourceCheck.targetTopic")}</option>
            </select>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as SourceCheckScope)}
              disabled={phase.status === "planning"}
              className="text-xs border border-border rounded px-2 py-1 bg-background"
              aria-label={t("wikiLint.sourceCheck.scopeLabel")}
            >
              <option value="unchecked">{t("wikiLint.sourceCheck.scopeUnchecked")}</option>
              <option value="stale">{t("wikiLint.sourceCheck.scopeStale")}</option>
              <option value="all">{t("wikiLint.sourceCheck.scopeAll")}</option>
            </select>
            <button
              onClick={handlePlan}
              disabled={phase.status === "planning"}
              className="rounded px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {phase.status === "planning" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <FileSearch size={12} />
              )}
              {phase.status === "planning"
                ? t("wikiLint.sourceCheck.planning")
                : t("wikiLint.sourceCheck.planButton")}
            </button>
          </div>
        )}

        {showLocal && phase.status === "planned" && (
          <div className="flex flex-col items-center gap-2">
            <div className="text-foreground">
              {t("wikiLint.sourceCheck.planSummary", {
                targets: String(phase.plan.targetCount),
                calls: String(phase.plan.plan.llmCalls),
              })}
            </div>
            <div className="text-muted-foreground">{t("sourceCheck.llmCallsCaveat")}</div>
            {Object.keys(phase.plan.plan.missingCounts).length > 0 && (
              <div className="text-muted-foreground">
                {t("wikiLint.sourceCheck.missingSummaryPrefix")} {missingSummary(phase.plan)}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => void handleConfirmRun(phase.plan)}
                disabled={phase.plan.targetCount === 0}
                className="rounded px-3 py-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {t("wikiLint.sourceCheck.runButton")}
              </button>
              <button
                onClick={() => setPhase({ status: "idle" })}
                className="rounded px-3 py-1.5 text-xs border border-border hover:bg-muted transition-colors"
              >
                {t("wikiLint.sourceCheck.cancelPlan")}
              </button>
            </div>
          </div>
        )}

        {showRunning && (
          <div className="flex flex-col items-center gap-2" aria-live="polite">
            <Loader2 size={24} className="animate-spin text-primary" />
            <span>
              {progress
                ? t("wikiLint.sourceCheck.progress", {
                    index: String(progress.index + 1),
                    total: String(progress.total),
                  })
                : t("wikiLint.sourceCheck.planning")}
            </span>
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs border border-border hover:bg-muted transition-colors"
            >
              <X size={11} />
              {t("wikiLint.sourceCheck.cancelRun")}
            </button>
          </div>
        )}

        {showResult && result && (
          <div className="flex flex-col items-center gap-1" aria-live="polite">
            <div className="text-foreground">
              {t("wikiLint.sourceCheck.doneCount", { count: String(result.profiles.size) })}
              {result.interrupted && ` (${t("wikiLint.sourceCheck.interrupted")})`}
            </div>
            {result.profiles.size > 0 && (
              <div className="text-muted-foreground">{verdictSummary(result)}</div>
            )}
            <button
              onClick={() => {
                onDismissResult();
                setPhase({ status: "idle" });
              }}
              className="inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs border border-border hover:bg-muted transition-colors mt-1"
            >
              {t("wikiLint.sourceCheck.runAgain")}
            </button>
          </div>
        )}
      </div>
      {/* 要確認一覧は常設 — 開始画面・計画・実行中・完了のどの段階でも件数があれば出す。
          中央揃えの開始画面の作りは崩さず、その下に全幅で置く（点検タブの issue リストと同じ見た目）。 */}
      {reviewList && <SourceCheckReviewList {...reviewList} />}
    </div>
  );
}
