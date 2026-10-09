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
