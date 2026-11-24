// 設定の点検・整理「資料からトピックを作る」のカード。
// 知見はできたのに、トピックがまだ無い資料に、トピックの段だけを 1 本ずつ回す（知見は作り直さない）。
// 人が起動する・先に本数を見せる・止められる・続きから再開できる（「知見をトピックに結ぶ」と同じ作法）。
// 対象が無くなったらカードごと消える。

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n";
import { Button } from "@ui/button";
import { confirmAction } from "../../ui/confirm-dialog";
import { SETTINGS_CARD_CLASS } from "./SettingsGroup";

/** 計画（AI を呼ぶ前に本数を見せる） */
export type SourceTopicBackfillSummary = { sources: number; alreadySettled: number };
export type SourceTopicBackfillOutcome = {
  done: number;
  total: number;
  topicsTouched: number;
  created: number;
  noTopic: number;
  unreadable: number;
  failedSources: number;
  aborted: boolean;
  stoppedByFailures: boolean;
  /** 失敗の理由（画面に出せる文） */
  failureReason?: string;
};
export type SourceTopicBackfillProgressView = { done: number; total: number; topicsTouched: number };
export type SourceTopicBackfillHandlers = {
  plan: () => Promise<SourceTopicBackfillSummary>;
  /** AI が未設定などで始められないときは null */
  run: (
    onProgress: (progress: SourceTopicBackfillProgressView) => void,
    signal: AbortSignal,
  ) => Promise<SourceTopicBackfillOutcome | null>;
};

export function SourceTopicBackfillCard({ handlers }: { handlers: SourceTopicBackfillHandlers }) {
  const t = useT();
  const [plan, setPlan] = useState<SourceTopicBackfillSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SourceTopicBackfillProgressView | null>(null);
  const [outcome, setOutcome] = useState<SourceTopicBackfillOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshPlan = useCallback(async () => {
    try {
      setPlan(await handlers.plan());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [handlers]);
  useEffect(() => { void refreshPlan(); }, [refreshPlan]);
  // 設定を閉じたら止める（対象はデータから選び直すので、次に開けば続きから回せる）
  useEffect(() => () => abortRef.current?.abort(), []);

  if (!running && !outcome && (plan?.sources ?? 0) === 0) return null;

  const start = async () => {
    const next = await handlers.plan();
    setPlan(next);
    if (next.sources === 0) return;
    if (!(await confirmAction(t("settings.maintenance.sourceTopics.confirm", { sources: String(next.sources) })))) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setOutcome(null);
    setError(null);
    setProgress({ done: 0, total: next.sources, topicsTouched: 0 });
    try {
      const result = await handlers.run(setProgress, controller.signal);
      if (result) setOutcome(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      abortRef.current = null;
      setRunning(false);
      void refreshPlan();
    }
  };

  const warn = outcome && (outcome.failedSources > 0 || outcome.aborted);
  return (
    <div className={`${SETTINGS_CARD_CLASS} p-3 space-y-3`}>
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-1">{t("settings.maintenance.sourceTopics.title")}</h3>
        {plan && plan.sources > 0 && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("settings.maintenance.sourceTopics.help", { sources: String(plan.sources) })}
            {plan.alreadySettled > 0
              ? ` ${t("settings.maintenance.sourceTopics.settledHelp", { settled: String(plan.alreadySettled) })}`
              : ""}
          </p>
        )}
      </div>
      {running && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            {t("settings.maintenance.sourceTopics.running", {
              done: String(progress?.done ?? 0),
              total: String(progress?.total ?? plan?.sources ?? 0),
              topics: String(progress?.topicsTouched ?? 0),
            })}
          </div>
          <div>{t("settings.maintenance.sourceTopics.closeNote")}</div>
        </div>
      )}
      {outcome && !running && (
        <div className={warn ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs text-emerald-600 dark:text-emerald-400"}>
          {outcome.aborted
            ? t("settings.maintenance.sourceTopics.stopped", {
                done: String(outcome.done),
                total: String(outcome.total),
                topics: String(outcome.topicsTouched),
              })
            : t("settings.maintenance.sourceTopics.done", {
                done: String(outcome.done),
                topics: String(outcome.topicsTouched),
                created: String(outcome.created),
              })}
          {outcome.noTopic + outcome.unreadable > 0
            ? ` · ${t("settings.maintenance.sourceTopics.noTopic", { count: String(outcome.noTopic + outcome.unreadable) })}`
            : ""}
          {outcome.failedSources > 0
            ? ` · ${t("settings.maintenance.sourceTopics.failed", { count: String(outcome.failedSources) })}`
            : ""}
          {outcome.stoppedByFailures ? ` · ${t("settings.maintenance.sourceTopics.stoppedByFailures")}` : ""}
          {outcome.failureReason ? ` · ${outcome.failureReason}` : ""}
        </div>
      )}
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      {running ? (
        <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
          {t("settings.maintenance.sourceTopics.stop")}
        </Button>
      ) : (plan?.sources ?? 0) > 0 && (
        <Button size="sm" onClick={() => void start()}>
          {t("settings.maintenance.sourceTopics.run")}
        </Button>
      )}
    </div>
  );
}
