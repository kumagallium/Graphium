// 手入れ画面の一括処理（足りないところを補う・全体をやり直す）の状態と実行。
// もとは設定の「ナレッジ管理」タブが持っていた（2026-11-25 に手入れ画面へ移した）。
// 手入れの画面を離れても止めずに続ける（2026-11-24 決定「裏で続ける」）ため、状態は常に載っている
// note-app で持つ。手入れ画面は返り値の行を並べるだけ。
// 進み具合は取り込みのトーストにも 1 行で出す（実行中から。終わったら結果の行に変わる）。
// トーストの「停止」で止まるよう、中断ハンドルはトーストの停止の集合に入れる。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { confirmAction } from "../../ui/confirm-dialog";
import type { WikiKind } from "../../lib/document-types";
import type { IngestToastItem } from "./IngestToast";
import type { UpkeepJob, UpkeepJobStatus } from "./UpkeepJobSections";
import type { BulkRegenerateBlockProps, BulkRegenerateFailedItem, BulkRegenerateModelOption } from "./BulkRegenerateBlock";
import type {
  AssignTopicTypesResult,
  ClaimTopicLinkBackfillHandlers,
  ClaimTopicLinkBackfillOutcome,
  ClaimTopicLinkBackfillSummary,
  DiscoveryHandler,
  PlanDiscoveryHandler,
  RegenerateWikiHandler,
  SourceTopicBackfillHandlers,
  SourceTopicBackfillOutcome,
  SourceTopicBackfillSummary,
  UpkeepWikiSummary,
} from "./upkeep-job-types";

/** トーストへの書き込み口（note-app の取り込みトーストに 1 行で出す） */
export type UpkeepToastSink = {
  /** id が同じ行があれば置き換え、無ければ足す */
  upsert: (item: IngestToastItem) => void;
  /** トーストの「停止」で止めたい中断ハンドルを登録する。返り値で外す */
  registerAbort: (controller: AbortController) => () => void;
};

export type UseUpkeepJobsOptions = {
  /** 手入れ画面が開いているか。開いたときに対象の数を数え直す */
  active: boolean;
  toast: UpkeepToastSink;
  sourceTopics?: SourceTopicBackfillHandlers;
  linkClaims?: ClaimTopicLinkBackfillHandlers;
  topicTypes?: {
    untypedCount: number;
    run: (onProgress: (done: number, total: number) => void, signal: AbortSignal) => Promise<AssignTopicTypesResult>;
  };
  insights?: { claimCount: number; plan: PlanDiscoveryHandler; run: DiscoveryHandler };
  regenerate?: {
    summaries: UpkeepWikiSummary[];
    run: RegenerateWikiHandler;
    /** 対象 id 列から AI 呼び出し回数を見積もる（トピックは資料の数ぶん呼ぶ）。無ければ件数と同じ */
    estimateCalls?: (ids: string[]) => number;
    models: BulkRegenerateModelOption[];
    /** モデルを選んでいないときに使うモデル名（選択欄の「現在の設定」の印） */
    defaultModel: string;
    /** 実行の時点の既定モデル名。画面を開いたあとに設定でモデルを変えても、新しい方で動かすため */
    resolveDefaultModel?: () => string;
  };
};

export type UpkeepJobsView = {
  /** 足りないところを補う（対象のある行と、走っている・結果を見せている行だけ） */
  fillGaps: UpkeepJob[];
  /** 全体をやり直す の一括再生成（呼び出し口が無ければ null） */
  regenerate: Omit<BulkRegenerateBlockProps, "unavailable"> | null;
};

const REGEN_KINDS: WikiKind[] = ["topic", "claim", "atom"];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 行の状態を、トーストの 1 行に写す */
function toToastItem(id: string, title: string, status: UpkeepJobStatus, aborted = false): IngestToastItem | null {
  if (status.kind === "idle") return null;
  if (status.kind === "running") {
    // 2 回目の実行で前回の結果文が残らないよう、result を明示的に空にする（upsert は上書きで合成する）
    return { id, status: "generating", noteTitle: title, detail: status.text, result: undefined, excludeFromCount: true };
  }
  return {
    id,
    status: aborted ? "aborted" : status.tone === "error" ? "error" : "success",
    noteTitle: title,
    detail: undefined,
    result: status.text,
    excludeFromCount: true,
  };
}

export function useUpkeepJobs(opts: UseUpkeepJobsOptions): UpkeepJobsView {
  const t = useT();
  const { active, toast, sourceTopics, linkClaims, topicTypes, insights, regenerate } = opts;
  // 実行中に別の props が来ても、最新のトースト口を使う
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // 呼び出し元（note-app）の handler は描画のたびに作り直されることがある。数え直しの effect を
  // handler の参照に結ぶと、数え直し → state 更新 → 再描画 → 新しい handler → 数え直し… と回り続ける
  // ので、最新の handler は ref から読み、effect は「開いた」「使えるようになった」ときだけ走らせる
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // 確認ダイアログを待つ間の連打で二重に始めないための印（running の state は確認のあとで立つ）
  const busyRef = useRef(new Set<string>());
  const guarded = useCallback((jobId: string, fn: () => Promise<void>) => () => {
    if (busyRef.current.has(jobId)) return;
    busyRef.current.add(jobId);
    void fn().finally(() => busyRef.current.delete(jobId));
  }, []);

  /** トーストの「停止」で止まるよう中断ハンドルを登録する。返り値は後始末 */
  const startToastJob = useCallback(
    (controller: AbortController) => toastRef.current.registerAbort(controller),
    [],
  );
  // トーストの行は実行ごとに分ける（同じ id を使い回すと、所要時間が前回の開始・終了時刻を引き継ぐ）
  const toastRunRef = useRef<Record<string, string>>({});
  const beginToastRun = useCallback((jobId: string) => {
    toastRunRef.current[jobId] = `upkeep:${jobId}:${Date.now().toString(36)}`;
  }, []);
  const pushToast = useCallback((jobId: string, title: string, status: UpkeepJobStatus, aborted = false) => {
    const item = toToastItem(toastRunRef.current[jobId] ?? `upkeep:${jobId}`, title, status, aborted);
    if (item) toastRef.current.upsert(item);
  }, []);

  // ── 資料からトピックを作る ──
  const [stPlan, setStPlan] = useState<SourceTopicBackfillSummary | null>(null);
  const [stRunning, setStRunning] = useState(false);
  const [stProgress, setStProgress] = useState<{ done: number; total: number; topicsTouched: number } | null>(null);
  const [stOutcome, setStOutcome] = useState<SourceTopicBackfillOutcome | null>(null);
  const [stError, setStError] = useState<string | null>(null);
  const stAbortRef = useRef<AbortController | null>(null);

  // ── 知見をトピックに結ぶ ──
  const [lcPlan, setLcPlan] = useState<ClaimTopicLinkBackfillSummary | null>(null);
  const [lcRunning, setLcRunning] = useState(false);
  const [lcProgress, setLcProgress] = useState<{ done: number; total: number; linkedClaims: number } | null>(null);
  const [lcOutcome, setLcOutcome] = useState<ClaimTopicLinkBackfillOutcome | null>(null);
  const [lcError, setLcError] = useState<string | null>(null);
  const lcAbortRef = useRef<AbortController | null>(null);

  // ── トピックに種類を付ける ──
  const [ttRunning, setTtRunning] = useState(false);
  const [ttProgress, setTtProgress] = useState<{ done: number; total: number } | null>(null);
  const [ttResult, setTtResult] = useState<AssignTopicTypesResult | null>(null);
  const [ttError, setTtError] = useState<string | null>(null);
  const ttAbortRef = useRef<AbortController | null>(null);

  // ── 知見をまたぐ洞察を発見 ──
  type InsightState =
    | { kind: "running"; covered?: number; total?: number; created: number }
    | { kind: "done"; created: number; reinforced: number; contradictions: number; covered?: number; total?: number; aborted: boolean }
    | { kind: "error"; error: string };
  const [inState, setInState] = useState<InsightState | null>(null);
  const inAbortRef = useRef<AbortController | null>(null);

  // ── ナレッジの一括再生成 ──
  const [regenKinds, setRegenKinds] = useState<Set<WikiKind>>(() => new Set(REGEN_KINDS));
  const [ingestModel, setIngestModel] = useState("");
  const [synthesisModel, setSynthesisModel] = useState("");
  const [regenRunning, setRegenRunning] = useState(false);
  const [regenCancelling, setRegenCancelling] = useState(false);
  const [regenProgress, setRegenProgress] = useState<{
    done: number;
    total: number;
    failed: number;
    current?: string;
    currentModel?: string;
    failedItems: BulkRegenerateFailedItem[];
  } | null>(null);
  const regenAbortRef = useRef<AbortController | null>(null);

  // 対象の数え直し（手入れ画面を開いたとき・各処理が終わったとき）
  const refreshSourceTopicsPlan = useCallback(async () => {
    const handlers = optsRef.current.sourceTopics;
    if (!handlers) return;
    try {
      const next = await handlers.plan();
      // 変わっていなければ state を替えない（再描画を増やさない）
      setStPlan((prev) => (prev && prev.sources === next.sources && prev.alreadySettled === next.alreadySettled ? prev : next));
    } catch (err) {
      setStError(errorText(err));
    }
  }, []);
  const refreshLinkClaimsPlan = useCallback(async () => {
    const handlers = optsRef.current.linkClaims;
    if (!handlers) return;
    try {
      const next = await handlers.plan();
      setLcPlan((prev) => (
        prev && prev.calls === next.calls && prev.claims === next.claims && prev.alreadyJudged === next.alreadyJudged ? prev : next
      ));
    } catch (err) {
      setLcError(errorText(err));
    }
  }, []);
  const hasSourceTopics = Boolean(sourceTopics);
  const hasLinkClaims = Boolean(linkClaims);
  useEffect(() => {
    if (!active) return;
    if (hasSourceTopics) void refreshSourceTopicsPlan();
    if (hasLinkClaims) void refreshLinkClaimsPlan();
  }, [active, hasSourceTopics, hasLinkClaims, refreshSourceTopicsPlan, refreshLinkClaimsPlan]);

  // ── 実行 ──
  const runSourceTopics = useCallback(async () => {
    if (!sourceTopics || stRunning) return;
    const title = t("settings.maintenance.sourceTopics.title");
    const plan = await sourceTopics.plan();
    setStPlan(plan);
    if (plan.sources === 0) return;
    if (!(await confirmAction(t("settings.maintenance.sourceTopics.confirm", { sources: String(plan.sources) })))) return;
    const controller = new AbortController();
    stAbortRef.current = controller;
    const unregister = startToastJob(controller);
    beginToastRun("sourceTopics");
    const runningText = (p: { done: number; total: number; topicsTouched: number }) =>
      t("settings.maintenance.sourceTopics.running", {
        done: String(p.done),
        total: String(p.total),
        topics: String(p.topicsTouched),
      });
    const first = { done: 0, total: plan.sources, topicsTouched: 0 };
    setStRunning(true);
    setStOutcome(null);
    setStError(null);
    setStProgress(first);
    pushToast("sourceTopics", title, { kind: "running", text: runningText(first) });
    try {
      const outcome = await sourceTopics.run((p) => {
        setStProgress(p);
        pushToast("sourceTopics", title, { kind: "running", text: runningText(p) });
      }, controller.signal);
      if (outcome) {
        setStOutcome(outcome);
        const st = sourceTopicsResultStatus(t, outcome);
        pushToast("sourceTopics", title, st, outcome.aborted);
      } else {
        // AI が未設定などで始められなかった（理由は呼び出し側が別に知らせる）
        pushToast("sourceTopics", title, { kind: "result", tone: "warn", text: t("ingest.aborted") }, true);
      }
    } catch (err) {
      setStError(errorText(err));
      pushToast("sourceTopics", title, { kind: "result", tone: "error", text: errorText(err) });
    } finally {
      unregister();
      stAbortRef.current = null;
      setStRunning(false);
      void refreshSourceTopicsPlan();
    }
  }, [sourceTopics, stRunning, t, startToastJob, beginToastRun, pushToast, refreshSourceTopicsPlan]);

  const runLinkClaims = useCallback(async () => {
    if (!linkClaims || lcRunning) return;
    const title = t("settings.maintenance.linkClaimsToTopics.title");
    const plan = await linkClaims.plan();
    setLcPlan(plan);
    if (plan.calls === 0) return;
    if (!(await confirmAction(t("settings.maintenance.linkClaimsToTopics.confirm", { claims: String(plan.claims), calls: String(plan.calls) })))) return;
    const controller = new AbortController();
    lcAbortRef.current = controller;
    const unregister = startToastJob(controller);
    beginToastRun("linkClaims");
    const runningText = (p: { done: number; total: number; linkedClaims: number }) =>
      t("settings.maintenance.linkClaimsToTopics.running", {
        done: String(p.done),
        total: String(p.total),
        linked: String(p.linkedClaims),
      });
    const first = { done: 0, total: plan.calls, linkedClaims: 0 };
    setLcRunning(true);
    setLcOutcome(null);
    setLcError(null);
    setLcProgress(first);
    pushToast("linkClaims", title, { kind: "running", text: runningText(first) });
    try {
      const outcome = await linkClaims.run((p) => {
        setLcProgress(p);
        pushToast("linkClaims", title, { kind: "running", text: runningText(p) });
      }, controller.signal);
      if (outcome) {
        setLcOutcome(outcome);
        pushToast("linkClaims", title, linkClaimsResultStatus(t, outcome), outcome.aborted);
      } else {
        pushToast("linkClaims", title, { kind: "result", tone: "warn", text: t("ingest.aborted") }, true);
      }
    } catch (err) {
      setLcError(errorText(err));
      pushToast("linkClaims", title, { kind: "result", tone: "error", text: errorText(err) });
    } finally {
      unregister();
      lcAbortRef.current = null;
      setLcRunning(false);
      void refreshLinkClaimsPlan();
    }
  }, [linkClaims, lcRunning, t, startToastJob, beginToastRun, pushToast, refreshLinkClaimsPlan]);

  const runTopicTypes = useCallback(async () => {
    if (!topicTypes || ttRunning || topicTypes.untypedCount === 0) return;
    const title = t("settings.maintenance.assignTopicTypes.title");
    const count = topicTypes.untypedCount;
    const calls = Math.ceil(count / 50);
    if (!(await confirmAction(t("settings.maintenance.assignTopicTypes.confirm", { count: String(count), calls: String(calls) })))) return;
    const runningText = (done: number, total: number) =>
      t("settings.maintenance.assignTopicTypes.running", { done: String(done), total: String(total) });
    const controller = new AbortController();
    ttAbortRef.current = controller;
    const unregister = startToastJob(controller);
    setTtRunning(true);
    setTtResult(null);
    setTtError(null);
    setTtProgress({ done: 0, total: count });
    beginToastRun("topicTypes");
    pushToast("topicTypes", title, { kind: "running", text: runningText(0, count) });
    try {
      const result = await topicTypes.run((done, total) => {
        setTtProgress({ done, total });
        pushToast("topicTypes", title, { kind: "running", text: runningText(done, total) });
      }, controller.signal);
      setTtResult(result);
      pushToast("topicTypes", title, topicTypesResultStatus(t, result), controller.signal.aborted);
    } catch (err) {
      if (controller.signal.aborted) {
        pushToast("topicTypes", title, { kind: "result", tone: "warn", text: t("ingest.aborted") }, true);
      } else {
        setTtError(errorText(err));
        pushToast("topicTypes", title, { kind: "result", tone: "error", text: errorText(err) });
      }
    } finally {
      unregister();
      ttAbortRef.current = null;
      setTtRunning(false);
    }
  }, [topicTypes, ttRunning, t, startToastJob, beginToastRun, pushToast]);

  const runInsights = useCallback(async () => {
    if (!insights || inState?.kind === "running" || insights.claimCount < 2) return;
    const title = t("settings.maintenance.atomize.title");
    // 実行前プラン: 「全 {claims} 件を視野に入れるには {runs} 回」の実測値を確認ダイアログに出す（LLM は呼ばない）
    const plan = await insights.plan();
    if (!plan) return;
    if (!(await confirmAction(t("settings.maintenance.atomize.confirm", { claims: String(plan.total), runs: String(plan.runs) })))) return;
    const controller = new AbortController();
    inAbortRef.current = controller;
    const unregister = startToastJob(controller);
    beginToastRun("insights");
    const runningText = (covered: number | undefined, total: number | undefined) => {
      const head = t("settings.maintenance.atomize.discovering", { count: String(insights.claimCount) });
      return covered !== undefined && total !== undefined
        ? `${head} · ${t("settings.maintenance.atomize.coverage", { covered: String(covered), total: String(total) })}`
        : head;
    };
    setInState({ kind: "running", covered: 0, total: plan.total, created: 0 });
    pushToast("insights", title, { kind: "running", text: runningText(0, plan.total) });
    try {
      const result = await insights.run((info) => {
        setInState({ kind: "running", covered: info.coveredSoFar, total: info.populationTotal, created: info.createdSoFar });
        pushToast("insights", title, { kind: "running", text: runningText(info.coveredSoFar, info.populationTotal) });
      }, { signal: controller.signal });
      if (result.ok || result.aborted) {
        // 中断でも作成済み分と実測カバレッジは見せる（失敗表示にはしない）
        const next: InsightState = {
          kind: "done",
          created: result.created,
          reinforced: result.reinforced ?? 0,
          contradictions: result.contradictions ?? 0,
          covered: result.covered,
          total: result.total,
          aborted: Boolean(result.aborted),
        };
        setInState(next);
        pushToast("insights", title, insightsResultStatus(t, next), Boolean(result.aborted));
      } else {
        const error = result.error ?? "unknown";
        setInState({ kind: "error", error });
        pushToast("insights", title, { kind: "result", tone: "error", text: `${t("settings.maintenance.failed")}: ${error}` });
      }
    } catch (err) {
      setInState({ kind: "error", error: errorText(err) });
      pushToast("insights", title, { kind: "result", tone: "error", text: `${t("settings.maintenance.failed")}: ${errorText(err)}` });
    } finally {
      unregister();
      inAbortRef.current = null;
    }
  }, [insights, inState, t, startToastJob, beginToastRun, pushToast]);

  // ── 一括再生成 ──
  const summaries = regenerate?.summaries;
  const regenTargets = useMemo(
    () => (summaries ?? []).filter((w) => regenKinds.has(w.kind)),
    [summaries, regenKinds],
  );
  const effectiveIngestModel = ingestModel || regenerate?.defaultModel || "";
  const effectiveSynthesisModel = synthesisModel || regenerate?.defaultModel || "";

  const runRegenerate = useCallback(async (items: { id: string; title: string }[]) => {
    if (!regenerate || regenRunning || items.length === 0) return;
    const title = t("settings.maintenance.regenAll.title");
    const kindById = new Map(regenerate.summaries.map((w) => [w.id, w.kind]));
    // 対象にトピックが 1 件以上含まれるときだけ、AI 呼び出し回数を見せる確認に切り替える
    // （トピックは資料から作り直すため 1 件で資料数ぶん呼ぶ — 実行前に必ず見せる方針）
    const hasTopic = items.some((i) => kindById.get(i.id) === "topic");
    const confirmMsg = hasTopic
      ? t("settings.maintenance.confirmWithCalls", {
          count: String(items.length),
          calls: String(regenerate.estimateCalls ? regenerate.estimateCalls(items.map((i) => i.id)) : items.length),
        })
      : t("settings.maintenance.confirm", { count: String(items.length) });
    if (!(await confirmAction(confirmMsg, { destructive: true }))) return;

    // 選択欄で選んでいなければ、実行の時点の既定モデルを使う
    const runDefault = regenerate.resolveDefaultModel?.() || regenerate.defaultModel;
    const ingestModelForRun = ingestModel || runDefault;
    const synthesisModelForRun = synthesisModel || runDefault;
    const controller = new AbortController();
    regenAbortRef.current = controller;
    const unregister = startToastJob(controller);
    beginToastRun("regenerate");
    setRegenRunning(true);
    setRegenCancelling(false);
    const runningText = (done: number, total: number, current?: string) =>
      current ? `${done} / ${total} · ${current}` : `${done} / ${total}`;
    let done = 0;
    let failed = 0;
    const failedItems: BulkRegenerateFailedItem[] = [];
    setRegenProgress({ done: 0, total: items.length, failed: 0, failedItems: [] });
    pushToast("regenerate", title, { kind: "running", text: runningText(0, items.length) });
    try {
      for (const w of items) {
        if (controller.signal.aborted) break;
        const kind = kindById.get(w.id);
        const modelForKind = kind === "synthesis" ? synthesisModelForRun : ingestModelForRun;
        setRegenProgress({ done, total: items.length, failed, current: w.title, currentModel: modelForKind, failedItems: [...failedItems] });
        pushToast("regenerate", title, { kind: "running", text: runningText(done, items.length, w.title) });
        const result = await regenerate.run(w.id, {
          ...(modelForKind ? { model: modelForKind } : {}),
          signal: controller.signal,
        });
        // ユーザーの中断は失敗に数えない（done にも数えず、そのまま抜ける）
        if (result.aborted || controller.signal.aborted) break;
        if (!result.ok) {
          failed += 1;
          failedItems.push({ id: w.id, title: w.title, error: result.error });
        }
        done += 1;
        setRegenProgress({ done, total: items.length, failed, failedItems: [...failedItems] });
      }
      const aborted = controller.signal.aborted;
      const tail = aborted ? t("ingest.aborted") : t("settings.maintenance.done");
      const text = `${done} / ${items.length} · ${tail}`
        + (failed > 0 ? ` · ${t("settings.maintenance.failed")}: ${failed}` : "");
      pushToast("regenerate", title, { kind: "result", tone: failed > 0 || aborted ? "warn" : "ok", text }, aborted);
    } catch (err) {
      pushToast("regenerate", title, { kind: "result", tone: "error", text: `${done} / ${items.length} · ${errorText(err)}` });
    } finally {
      unregister();
      regenAbortRef.current = null;
      setRegenRunning(false);
      setRegenCancelling(false);
    }
  }, [regenerate, regenRunning, t, ingestModel, synthesisModel, startToastJob, beginToastRun, pushToast]);

  // ── 行に組み立てる ──
  const fillGaps: UpkeepJob[] = [];

  if (sourceTopics && (stRunning || stOutcome || stError || (stPlan?.sources ?? 0) > 0)) {
    const plan = stPlan;
    fillGaps.push({
      id: "sourceTopics",
      title: t("settings.maintenance.sourceTopics.title"),
      help: plan && plan.sources > 0
        ? t("settings.maintenance.sourceTopics.help", { sources: String(plan.sources) })
          + (plan.alreadySettled > 0 ? ` ${t("settings.maintenance.sourceTopics.settledHelp", { settled: String(plan.alreadySettled) })}` : "")
        : undefined,
      status: stRunning
        ? {
            kind: "running",
            text: t("settings.maintenance.sourceTopics.running", {
              done: String(stProgress?.done ?? 0),
              total: String(stProgress?.total ?? plan?.sources ?? 0),
              topics: String(stProgress?.topicsTouched ?? 0),
            }),
            done: stProgress?.done ?? 0,
            total: stProgress?.total ?? plan?.sources ?? 0,
          }
        : stError
          ? { kind: "result", tone: "error", text: stError }
          : stOutcome
            ? sourceTopicsResultStatus(t, stOutcome)
            : { kind: "idle" },
      runLabel: t("settings.maintenance.sourceTopics.run"),
      onRun: (plan?.sources ?? 0) > 0 ? guarded("sourceTopics", runSourceTopics) : undefined,
      onStop: () => stAbortRef.current?.abort(),
      stopLabel: t("settings.maintenance.sourceTopics.stop"),
    });
  }

  if (linkClaims && (lcRunning || lcOutcome || lcError || (lcPlan?.calls ?? 0) > 0)) {
    const plan = lcPlan;
    fillGaps.push({
      id: "linkClaims",
      title: t("settings.maintenance.linkClaimsToTopics.title"),
      help: plan && plan.calls > 0
        ? t("settings.maintenance.linkClaimsToTopics.help", { claims: String(plan.claims) })
          + (plan.alreadyJudged > 0 ? ` ${t("settings.maintenance.linkClaimsToTopics.resumeHelp", { judged: String(plan.alreadyJudged) })}` : "")
        : undefined,
      status: lcRunning
        ? {
            kind: "running",
            text: t("settings.maintenance.linkClaimsToTopics.running", {
              done: String(lcProgress?.done ?? 0),
              total: String(lcProgress?.total ?? plan?.calls ?? 0),
              linked: String(lcProgress?.linkedClaims ?? 0),
            }),
            done: lcProgress?.done ?? 0,
            total: lcProgress?.total ?? plan?.calls ?? 0,
          }
        : lcError
          ? { kind: "result", tone: "error", text: lcError }
          : lcOutcome
            ? linkClaimsResultStatus(t, lcOutcome)
            : { kind: "idle" },
      runLabel: t(plan?.alreadyJudged ? "settings.maintenance.linkClaimsToTopics.resume" : "settings.maintenance.linkClaimsToTopics.run"),
      onRun: (plan?.calls ?? 0) > 0 ? guarded("linkClaims", runLinkClaims) : undefined,
      onStop: () => lcAbortRef.current?.abort(),
      stopLabel: t("settings.maintenance.linkClaimsToTopics.stop"),
    });
  }

  if (topicTypes && (ttRunning || ttResult || ttError || topicTypes.untypedCount > 0)) {
    fillGaps.push({
      id: "topicTypes",
      title: t("settings.maintenance.assignTopicTypes.title"),
      help: topicTypes.untypedCount > 0
        ? t("settings.maintenance.assignTopicTypes.help", { count: String(topicTypes.untypedCount) })
        : undefined,
      status: ttRunning
        ? {
            kind: "running",
            text: t("settings.maintenance.assignTopicTypes.running", {
              done: String(ttProgress?.done ?? 0),
              total: String(ttProgress?.total ?? topicTypes.untypedCount),
            }),
            done: ttProgress?.done ?? 0,
            total: ttProgress?.total ?? topicTypes.untypedCount,
          }
        : ttError
          ? { kind: "result", tone: "error", text: ttError }
          : ttResult
            ? topicTypesResultStatus(t, ttResult)
            : { kind: "idle" },
      runLabel: t("settings.maintenance.assignTopicTypes.run"),
      onRun: topicTypes.untypedCount > 0 ? guarded("topicTypes", runTopicTypes) : undefined,
      onStop: () => ttAbortRef.current?.abort(),
      stopLabel: t("settings.maintenance.sourceTopics.stop"),
    });
  }

  if (insights && (inState || insights.claimCount >= 2)) {
    fillGaps.push({
      id: "insights",
      title: t("settings.maintenance.atomize.title"),
      help: t("settings.maintenance.atomize.help", { count: String(insights.claimCount) }),
      status: inState?.kind === "running"
        ? {
            kind: "running",
            text: inState.covered !== undefined && inState.total !== undefined
              ? `${t("settings.maintenance.atomize.discovering", { count: String(insights.claimCount) })} · ${t("settings.maintenance.atomize.coverage", { covered: String(inState.covered), total: String(inState.total) })}`
              : t("settings.maintenance.atomize.discovering", { count: String(insights.claimCount) }),
            done: inState.covered,
            total: inState.total,
          }
        : inState?.kind === "error"
          ? { kind: "result", tone: "error", text: `${t("settings.maintenance.failed")}: ${inState.error}` }
          : inState?.kind === "done"
            ? insightsResultStatus(t, inState)
            : { kind: "idle" },
      runLabel: t("settings.maintenance.atomize.run"),
      onRun: insights.claimCount >= 2 ? guarded("insights", runInsights) : undefined,
      onStop: () => inAbortRef.current?.abort(),
      stopLabel: t("common.cancel"),
    });
  }

  const regenView: UpkeepJobsView["regenerate"] = regenerate
    ? {
        kinds: REGEN_KINDS.map((k) => ({
          kind: k,
          label: t(`settings.maintenance.kind.${k}`),
          count: regenerate.summaries.filter((w) => w.kind === k).length,
          checked: regenKinds.has(k),
        })),
        onToggleKind: (k) =>
          setRegenKinds((prev) => {
            const next = new Set(prev);
            if (next.has(k as WikiKind)) next.delete(k as WikiKind);
            else next.add(k as WikiKind);
            return next;
          }),
        // 既定で使うモデルに「（現在の設定）」を添える（選び直したいときだけ変える）
        models: regenerate.models.map((m) =>
          m.value === regenerate.defaultModel
            ? { ...m, label: `${m.label} ${t("settings.maintenance.currentSetting")}` }
            : m,
        ),
        ingestModel: effectiveIngestModel,
        onIngestModelChange: setIngestModel,
        synthesisModel: effectiveSynthesisModel,
        onSynthesisModelChange: setSynthesisModel,
        targetCount: regenTargets.length,
        totalCount: regenerate.summaries.length,
        estimatedCalls: regenerate.estimateCalls
          ? regenerate.estimateCalls(regenTargets.map((w) => w.id))
          : regenTargets.length,
        progress: regenProgress,
        running: regenRunning,
        cancelling: regenCancelling,
        onRun: guarded("regenerate", () => runRegenerate(regenTargets.map((w) => ({ id: w.id, title: w.title })))),
        onCancel: () => {
          setRegenCancelling(true);
          // 進行中の 1 件の fetch を切る → サーバー側の LLM 呼び出しも止まる
          regenAbortRef.current?.abort();
        },
        onRetryFailed: () => {
          if (!regenProgress) return;
          const failedItems = regenProgress.failedItems.map((f) => ({ id: f.id, title: f.title }));
          guarded("regenerate", () => runRegenerate(failedItems))();
        },
      }
    : null;

  return { fillGaps, regenerate: regenView };
}

type TFn = (key: string, params?: Record<string, string>) => string;

function sourceTopicsResultStatus(t: TFn, outcome: SourceTopicBackfillOutcome): UpkeepJobStatus {
  const warn = outcome.failedSources > 0 || outcome.aborted;
  const text = (outcome.aborted
    ? t("settings.maintenance.sourceTopics.stopped", {
        done: String(outcome.done),
        total: String(outcome.total),
        topics: String(outcome.topicsTouched),
      })
    : t("settings.maintenance.sourceTopics.done", {
        done: String(outcome.done),
        topics: String(outcome.topicsTouched),
        created: String(outcome.created),
      }))
    + (outcome.noTopic + outcome.unreadable > 0
      ? ` · ${t("settings.maintenance.sourceTopics.noTopic", { count: String(outcome.noTopic + outcome.unreadable) })}`
      : "")
    + (outcome.failedSources > 0
      ? ` · ${t("settings.maintenance.sourceTopics.failed", { count: String(outcome.failedSources) })}`
      : "")
    + (outcome.stoppedByFailures ? ` · ${t("settings.maintenance.sourceTopics.stoppedByFailures")}` : "")
    + (outcome.failureReason ? ` · ${outcome.failureReason}` : "");
  return { kind: "result", tone: warn ? "warn" : "ok", text };
}

function linkClaimsResultStatus(t: TFn, outcome: ClaimTopicLinkBackfillOutcome): UpkeepJobStatus {
  const warn = outcome.failedSources > 0 || outcome.aborted;
  const text = (outcome.aborted
    ? t("settings.maintenance.linkClaimsToTopics.stopped", {
        linked: String(outcome.linkedClaims),
        done: String(outcome.done),
        total: String(outcome.total),
      })
    : t("settings.maintenance.linkClaimsToTopics.done", {
        linked: String(outcome.linkedClaims),
        calls: String(outcome.calls),
      }))
    + (outcome.failedSources > 0
      ? ` · ${t("settings.maintenance.linkClaimsToTopics.failed", { count: String(outcome.failedSources) })}`
      : "")
    + (outcome.stoppedByFailures ? ` · ${t("settings.maintenance.linkClaimsToTopics.stoppedByFailures")}` : "")
    + (outcome.failureReason ? ` · ${outcome.failureReason}` : "");
  return { kind: "result", tone: warn ? "warn" : "ok", text };
}

function topicTypesResultStatus(t: TFn, result: AssignTopicTypesResult): UpkeepJobStatus {
  const text = t("settings.maintenance.assignTopicTypes.done", {
    assigned: String(result.assigned),
    total: String(result.total),
    calls: String(result.calls),
  }) + (result.failureReason ? ` · ${result.failureReason}` : "");
  return { kind: "result", tone: result.failureReason ? "warn" : "ok", text };
}

function insightsResultStatus(
  t: TFn,
  s: { created: number; reinforced: number; contradictions: number; covered?: number; total?: number; aborted: boolean },
): UpkeepJobStatus {
  const parts = [t("settings.maintenance.atomize.doneCount", { count: String(s.created) })];
  if (s.reinforced > 0) parts.push(t("settings.maintenance.atomize.reinforcedLine", { count: String(s.reinforced) }));
  if (s.contradictions > 0) parts.push(t("settings.maintenance.atomize.contradictionsLine", { count: String(s.contradictions) }));
  if (s.covered !== undefined && s.total !== undefined) {
    parts.push(t("settings.maintenance.atomize.coverage", { covered: String(s.covered), total: String(s.total) }));
  }
  return { kind: "result", tone: s.aborted ? "warn" : "ok", text: parts.join(" · ") };
}
