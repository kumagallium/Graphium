// Ingest 処理中のトースト通知（キュー対応）
// 複数ノートの連続 Ingest をキューで管理し、詳細進捗を表示

import { useEffect, useState } from "react";
import { Bot, Check, X, Loader2, Minus, ChevronDown, ChevronUp, Square } from "lucide-react";
import { useT } from "../../i18n";

/** パイプライン各ステージの状態 */
export type IngestStageStatus = "pending" | "running" | "done" | "skipped" | "error";

export type IngestStage = {
  /** 識別子（topics / atomize / lint など） */
  key: string;
  /** 表示用ラベル */
  label: string;
  status: IngestStageStatus;
  /** 結果や理由の補足（例: "2 atoms", "skipped: need ≥2 claims"） */
  detail?: string;
  /** running になった時刻（ms）。stampIngestTimings が付ける。所要時間の表示に使う */
  startedAt?: number;
  /** done / error になった時刻（ms）。stampIngestTimings が付ける */
  endedAt?: number;
};

export type IngestToastItem = {
  id: string;
  /** aborted = ユーザーが「停止」で止めた（失敗ではない） */
  status: "queued" | "generating" | "saving" | "success" | "error" | "aborted";
  noteTitle: string;
  /** 現在のステップの詳細 */
  detail?: string;
  /** 結果メッセージ */
  result?: string;
  /** generating / saving になった時刻（ms）。stampIngestTimings が付ける。所要時間の表示に使う */
  startedAt?: number;
  /** success / error / aborted になった時刻（ms）。stampIngestTimings が付ける */
  endedAt?: number;
  /**
   * success の項目の下に独立行で出す注記（例: 「原文で確認できなかった構造を 2 件破棄」）。
   * 結果行は truncate で切れるので、黙って落とさない約束（FAQ）に関わる件数はここに出す。
   */
  notice?: string;
  /** パイプライン後半（topics / atomize / lint）のステージ表示 */
  stages?: IngestStage[];
  /**
   * success の項目に添える 1 個のテキストボタン（例: 「出典照合を開く」）。
   * 結果行の下（pl-5）に小さく出す。押されても項目自体の状態は変えない。
   */
  action?: { label: string; onClick: () => void };
  /**
   * 見出しの件数（「完了: N 件生成」）から除外する（保存されない、画面の中だけの印）。
   * Knowledge pipeline の進捗行（stages 付き）は自動で除外されるが、出典照合の案内の
   * ような「案内・提案の行」はステージを持たないので、これで明示的に除外する
   */
  excludeFromCount?: boolean;
};

export type IngestToastState = {
  items: IngestToastItem[];
} | null;

/**
 * 見出しの件数（生成・エラー・停止）を、実際の取り込み結果だけで数える。
 * Knowledge pipeline の進捗行（stages 付き）と、excludeFromCount が付いた案内行
 * （出典照合の案内など）は数えない。分母（total）も同じ基準で数える。
 */
export function summarizeIngestToastCounts(items: IngestToastItem[]): {
  completed: number;
  error: number;
  aborted: number;
  total: number;
} {
  const countable = items.filter((i) => !i.stages && !i.excludeFromCount);
  return {
    completed: countable.filter((i) => i.status === "success").length,
    error: countable.filter((i) => i.status === "error").length,
    aborted: countable.filter((i) => i.status === "aborted").length,
    total: countable.length,
  };
}

/**
 * 所要時間を短く表す（"8s" / "1m 23s" / "1h 05m"）。言語に依らない形にして i18n を通さない。
 * 1 秒未満は "0s"。
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

const ITEM_ACTIVE: ReadonlySet<IngestToastItem["status"]> = new Set(["generating", "saving"]);
const ITEM_TERMINAL: ReadonlySet<IngestToastItem["status"]> = new Set(["success", "error", "aborted"]);
const STAGE_TERMINAL: ReadonlySet<IngestStageStatus> = new Set(["done", "error", "skipped"]);

/**
 * トーストの状態遷移に時刻を刻む。setIngestToast の更新をすべてここに通す（note-app の
 * チョークポイント）ことで、99 か所ある更新のどれも startedAt / endedAt を書かずに済む。
 *
 * - 項目: queued → generating/saving で startedAt、success/error/aborted で endedAt
 * - ステージ: running で startedAt、done/error/skipped で endedAt（走らずに skipped になった
 *   ステージは startedAt が無いので所要時間は出ない）
 *
 * 前の状態が持っていた時刻は、更新側の mapper がスプレッドで落としても引き継ぐ。
 * 既に付いている時刻は上書きしない（再描画で時計が進まない）。
 */
export function stampIngestTimings(
  prev: IngestToastState,
  next: IngestToastState,
  now: number = Date.now(),
): IngestToastState {
  if (!next) return next;
  const prevById = new Map((prev?.items ?? []).map((i) => [i.id, i]));
  let changed = false;
  const items = next.items.map((item) => {
    const before = prevById.get(item.id);
    let out = item;
    const startedAt = item.startedAt ?? before?.startedAt;
    const endedAt = item.endedAt ?? before?.endedAt;
    if (startedAt !== undefined && item.startedAt === undefined) out = { ...out, startedAt };
    if (endedAt !== undefined && item.endedAt === undefined) out = { ...out, endedAt };
    if (out.startedAt === undefined && ITEM_ACTIVE.has(item.status)) out = { ...out, startedAt: now };
    if (out.endedAt === undefined && out.startedAt !== undefined && ITEM_TERMINAL.has(item.status)) {
      out = { ...out, endedAt: now };
    }
    if (item.stages) {
      const prevStages = new Map((before?.stages ?? []).map((s) => [s.key, s]));
      let stagesChanged = false;
      const stages = item.stages.map((stage) => {
        const sBefore = prevStages.get(stage.key);
        let so = stage;
        const sStarted = stage.startedAt ?? sBefore?.startedAt;
        const sEnded = stage.endedAt ?? sBefore?.endedAt;
        if (sStarted !== undefined && stage.startedAt === undefined) so = { ...so, startedAt: sStarted };
        if (sEnded !== undefined && stage.endedAt === undefined) so = { ...so, endedAt: sEnded };
        if (so.startedAt === undefined && stage.status === "running") so = { ...so, startedAt: now };
        if (so.endedAt === undefined && so.startedAt !== undefined && STAGE_TERMINAL.has(stage.status)) {
          so = { ...so, endedAt: now };
        }
        if (so !== stage) stagesChanged = true;
        return so;
      });
      if (stagesChanged) out = { ...out, stages };
    }
    if (out !== item) changed = true;
    return out;
  });
  return changed ? { ...next, items } : next;
}

/** 表示用: 終わっていれば確定の所要時間、走っていれば now までの経過。時刻が無ければ null */
function elapsedOf(t: { startedAt?: number; endedAt?: number }, now: number): string | null {
  if (t.startedAt === undefined) return null;
  return formatElapsed((t.endedAt ?? now) - t.startedAt);
}

type Props = {
  state: IngestToastState;
  onDismiss: () => void;
  /**
   * 進行中の処理を止める。渡されていれば、処理中のヘッダーに「停止」ボタンを出す。
   * 押した側は fetch を abort し、残りのキューを aborted に畳む。
   */
  onStop?: () => void;
};

export function IngestToast({ state, onDismiss, onStop }: Props) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  // 最小化中はピル表示のみ（大量アイテム時にチャット欄等と重なるのを避ける）
  const [minimized, setMinimized] = useState(false);
  // 停止を押した直後〜実際に止まるまでの間、二度押しを防ぐ
  const [stopping, setStopping] = useState(false);

  const items = state?.items ?? [];
  // stages を持つアイテムは、いずれかのステージが pending/running の間 active 扱い。
  // これで Atomize→Synthesize→Lint と段階的に進む間にトーストが消えないようにする。
  const hasActiveStages = (item: IngestToastItem) =>
    !!item.stages?.some((s) => s.status === "pending" || s.status === "running");
  const hasActive = items.some(
    (i) =>
      i.status === "queued" ||
      i.status === "generating" ||
      i.status === "saving" ||
      hasActiveStages(i)
  );
  const allDone = items.length > 0 && !hasActive;

  // 走っている項目・ステージの経過時間を 1 秒ごとに進める（終わった行は endedAt で固定されるので
  // この時計には依存しない）。何も走っていなければ時計は止める
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hasActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasActive]);

  useEffect(() => {
    if (items.length > 0) {
      setVisible(true);
      if (allDone) {
        const timer = setTimeout(() => {
          setVisible(false);
          setTimeout(onDismiss, 300);
        }, 5000);
        return () => clearTimeout(timer);
      }
    } else {
      setVisible(false);
      // 次のバッチは展開状態から始める
      setMinimized(false);
      setStopping(false);
    }
  }, [items, allDone, onDismiss]);

  // 処理が全部止まったら「停止中」表示も解除（次のバッチに持ち越さない）
  useEffect(() => {
    if (!hasActive) setStopping(false);
  }, [hasActive]);

  if (!state || items.length === 0) return null;

  // 見出しの件数は、Knowledge pipeline の進捗行・案内行を除いた実際の取り込み結果だけで数える
  const { completed: completedCount, error: errorCount, aborted: abortedCount, total: countableTotal } =
    summarizeIngestToastCounts(items);
  const canStop = hasActive && !!onStop;
  // 件数に数えない項目（補完など）だけのときは、「ナレッジ生成」前提の見出し・件数を使わず、
  // 項目自身のタイトルを見出しにし、エラーも項目の状態でトーンに反映する
  const onlyUncounted = countableTotal === 0;
  const showError = onlyUncounted ? items.some((i) => i.status === "error") : errorCount > 0;
  const uncountedTitle = (items.find((i) => i.status === "generating" || i.status === "saving") ?? items[items.length - 1])
    ?.noteTitle;
  const handleStop = () => {
    if (!onStop || stopping) return;
    setStopping(true);
    onStop();
  };
  const activeItem = items.find((i) => i.status === "generating" || i.status === "saving");
  const queuedCount = items.filter((i) => i.status === "queued").length;

  // 展開表示とピル表示で共有する色・フェードのクラス
  const toneClasses = allDone
    ? showError
      ? "bg-destructive/10 border-destructive/20"
      : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
    : "bg-popover border-border";
  const fadeClasses = visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2";

  // 最小化中: 進捗カウントだけの小さなピル。クリックで再展開
  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        data-tooltip={t("ingest.expand")}
        aria-label={t("ingest.expand")}
        className={`fixed bottom-4 right-4 z-[9999] flex items-center gap-1.5 rounded-full border shadow-lg pl-3 pr-2 py-1.5 transition-all duration-300 ${toneClasses} ${fadeClasses}`}
      >
        {hasActive ? (
          <Loader2 size={12} className="animate-spin text-primary shrink-0" />
        ) : showError ? (
          <X size={12} className="text-destructive shrink-0" />
        ) : (
          <Check size={12} className="text-emerald-600 shrink-0" />
        )}
        <Bot size={12} className="text-muted-foreground shrink-0" />
        <span className="text-[11px] font-medium text-foreground tabular-nums">
          {onlyUncounted ? uncountedTitle : `${completedCount}/${countableTotal}`}
        </span>
        {errorCount > 0 && (
          <span className="flex items-center gap-0.5 text-[11px] font-medium text-destructive tabular-nums">
            <X size={10} className="shrink-0" />
            {errorCount}
          </span>
        )}
        <ChevronUp size={12} className="text-muted-foreground shrink-0" />
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-[9999] w-80 rounded-lg border shadow-lg transition-all duration-300 ${toneClasses} ${fadeClasses}`}
    >
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        {hasActive ? (
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
        ) : showError ? (
          <X size={14} className="text-destructive shrink-0" />
        ) : (
          <Check size={14} className="text-emerald-600 shrink-0" />
        )}
        <Bot size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground flex-1">
          {onlyUncounted && !(hasActive && stopping)
            ? uncountedTitle
            : hasActive
            ? stopping
              ? t("ingest.stopping")
              : t("ingest.generatingHeader", { done: String(completedCount), total: String(countableTotal) })
            : `${t("ingest.doneSummary", { count: String(completedCount) })}${errorCount > 0 ? t("ingest.doneErrorSuffix", { count: String(errorCount) }) : ""}${abortedCount > 0 ? t("ingest.doneAbortedSuffix", { count: String(abortedCount) }) : ""}`
          }
        </span>
        {canStop && (
          <button
            onClick={handleStop}
            disabled={stopping}
            data-tooltip={t("ingest.stop")}
            aria-label={t("ingest.stop")}
            className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-50"
          >
            <Square size={11} fill="currentColor" />
          </button>
        )}
        <button
          onClick={() => setMinimized(true)}
          data-tooltip={t("ingest.minimize")}
          aria-label={t("ingest.minimize")}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <ChevronDown size={12} />
        </button>
        {allDone && (
          <button
            onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* アイテムリスト */}
      <div className="px-3 py-1.5 space-y-1 max-h-60 overflow-y-auto">
        {items.map((item) => (
          <div key={item.id} className="space-y-0.5">
            <div className="flex items-center gap-2 text-[11px]">
              {item.status === "queued" && (
                <span className="w-3 h-3 rounded-full bg-muted-foreground/20 shrink-0" />
              )}
              {(item.status === "generating" || item.status === "saving") && (
                <Loader2 size={12} className="animate-spin text-primary shrink-0" />
              )}
              {item.status === "success" && (
                <Check size={12} className="text-emerald-600 shrink-0" />
              )}
              {item.status === "error" && (
                <X size={12} className="text-destructive shrink-0" />
              )}
              {item.status === "aborted" && (
                <Minus size={12} className="text-muted-foreground/60 shrink-0" />
              )}
              <span className={`truncate min-w-0 flex-1 ${item.status === "queued" || item.status === "aborted" ? "text-muted-foreground" : "text-foreground"}`}>
                {item.noteTitle}
              </span>
              {item.detail && (item.status === "generating" || item.status === "saving") && (
                <span className="text-muted-foreground/60 shrink-0">{item.detail}</span>
              )}
              {item.result && item.status === "aborted" && (
                <span className="text-muted-foreground/60 truncate min-w-0 shrink-0 max-w-[40%]">
                  — {item.result}
                </span>
              )}
              {item.result && item.status === "success" && (
                <span
                  className="text-muted-foreground/60 truncate min-w-0 shrink-0 max-w-[40%]"
                  title={item.result}
                >
                  — {item.result}
                </span>
              )}
              {/* 所要時間: 走っている間は経過、終われば確定値（stages を持つ進捗行はステージ側に出す） */}
              {!item.stages && item.status !== "queued" && elapsedOf(item, now) && (
                <span
                  className="text-muted-foreground/50 tabular-nums shrink-0"
                  data-testid="ingest-elapsed"
                >
                  {elapsedOf(item, now)}
                </span>
              )}
            </div>
            {/* エラーは長文になりやすいので独立行に出す。break-words で折り返す */}
            {item.result && item.status === "error" && (
              <div
                className="pl-5 pr-1 text-[11px] text-destructive/80 break-words whitespace-normal"
              >
                {item.result}
              </div>
            )}
            {/* 独立行の注記（破棄した frame 項目の件数など）。折り返して全文を見せる */}
            {item.notice && item.status === "success" && (
              <div className="pl-5 pr-1 text-[11px] text-muted-foreground break-words whitespace-normal">
                {item.notice}
              </div>
            )}
            {/* success の項目に添えるテキストボタン（例: 「出典照合を開く」） */}
            {item.action && (item.status === "success" || item.status === "aborted") && (
              <div className="pl-5">
                <button
                  type="button"
                  onClick={item.action.onClick}
                  className="text-[11px] text-primary hover:underline"
                >
                  {item.action.label}
                </button>
              </div>
            )}
            {/* パイプラインステージ（topics / atomize / lint） */}
            {item.stages && item.stages.length > 0 && (
              <ul className="pl-5 space-y-0.5">
                {item.stages.map((stage) => (
                  <li
                    key={stage.key}
                    className="flex items-center gap-2 text-[10px] leading-tight"
                  >
                    {stage.status === "pending" && (
                      <span className="w-2.5 h-2.5 rounded-full border border-muted-foreground/30 shrink-0" />
                    )}
                    {stage.status === "running" && (
                      <Loader2 size={10} className="animate-spin text-primary shrink-0" />
                    )}
                    {stage.status === "done" && (
                      <Check size={10} className="text-emerald-600 shrink-0" />
                    )}
                    {stage.status === "skipped" && (
                      <Minus size={10} className="text-muted-foreground/60 shrink-0" />
                    )}
                    {stage.status === "error" && (
                      <X size={10} className="text-destructive shrink-0" />
                    )}
                    <span
                      className={
                        stage.status === "pending" || stage.status === "skipped"
                          ? "text-muted-foreground"
                          : stage.status === "error"
                            ? "text-destructive/90"
                            : "text-foreground/80"
                      }
                    >
                      {stage.label}
                    </span>
                    {stage.detail && (
                      <span
                        className="text-muted-foreground/60 truncate min-w-0"
                        title={stage.detail}
                      >
                        — {stage.detail}
                      </span>
                    )}
                    {/* ステージの所要時間（running なら経過、done/error なら確定値） */}
                    {elapsedOf(stage, now) && (
                      <span
                        className="ml-auto text-muted-foreground/50 tabular-nums shrink-0"
                        data-testid="ingest-stage-elapsed"
                      >
                        {elapsedOf(stage, now)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {queuedCount > 0 && activeItem && (
          <div className="text-[10px] text-muted-foreground/50 mt-0.5">
            + {queuedCount} queued
          </div>
        )}
      </div>
    </div>
  );
}
