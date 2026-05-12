// Ingest 処理中のトースト通知（キュー対応）
// 複数ノートの連続 Ingest をキューで管理し、詳細進捗を表示

import { useEffect, useState } from "react";
import { Bot, Check, X, Loader2, Minus } from "lucide-react";

/** パイプライン各ステージの状態 */
export type IngestStageStatus = "pending" | "running" | "done" | "skipped" | "error";

export type IngestStage = {
  /** 識別子（cross-update / atomize / synthesize / lint など） */
  key: string;
  /** 表示用ラベル */
  label: string;
  status: IngestStageStatus;
  /** 結果や理由の補足（例: "2 atoms", "skipped: need ≥2 claims"） */
  detail?: string;
};

export type IngestToastItem = {
  id: string;
  status: "queued" | "generating" | "saving" | "success" | "error";
  noteTitle: string;
  /** 現在のステップの詳細 */
  detail?: string;
  /** 結果メッセージ */
  result?: string;
  /** パイプライン後半（cross-update / atomize / synthesize / lint）のステージ表示 */
  stages?: IngestStage[];
};

export type IngestToastState = {
  items: IngestToastItem[];
} | null;

type Props = {
  state: IngestToastState;
  onDismiss: () => void;
};

export function IngestToast({ state, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

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
    }
  }, [items, allDone, onDismiss]);

  if (!state || items.length === 0) return null;

  const completedCount = items.filter((i) => i.status === "success").length;
  const errorCount = items.filter((i) => i.status === "error").length;
  const activeItem = items.find((i) => i.status === "generating" || i.status === "saving");
  const queuedCount = items.filter((i) => i.status === "queued").length;

  return (
    <div
      className={`fixed bottom-4 right-4 z-[9999] w-80 rounded-lg border shadow-lg transition-all duration-300 ${
        allDone
          ? errorCount > 0
            ? "bg-destructive/10 border-destructive/20"
            : "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
          : "bg-popover border-border"
      } ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}
    >
      {/* ヘッダー */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50">
        {hasActive ? (
          <Loader2 size={14} className="animate-spin text-primary shrink-0" />
        ) : errorCount > 0 ? (
          <X size={14} className="text-destructive shrink-0" />
        ) : (
          <Check size={14} className="text-emerald-600 shrink-0" />
        )}
        <Bot size={14} className="text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground flex-1">
          {hasActive
            ? `Knowledge 生成中 (${completedCount}/${items.length})`
            : `完了: ${completedCount} 件生成${errorCount > 0 ? `, ${errorCount} 件エラー` : ""}`
          }
        </span>
        {allDone && (
          <button
            onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
            className="text-muted-foreground hover:text-foreground"
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
              <span className={`truncate ${item.status === "queued" ? "text-muted-foreground" : "text-foreground"}`}>
                {item.noteTitle}
              </span>
              {item.detail && (item.status === "generating" || item.status === "saving") && (
                <span className="text-muted-foreground/60 shrink-0">{item.detail}</span>
              )}
              {item.result && item.status === "error" && (
                <span
                  className="text-destructive/80 break-words whitespace-normal min-w-0 flex-1"
                  title={item.result}
                >
                  — {item.result}
                </span>
              )}
              {item.result && item.status === "success" && (
                <span
                  className="text-muted-foreground/60 truncate min-w-0"
                  title={item.result}
                >
                  — {item.result}
                </span>
              )}
            </div>
            {/* パイプラインステージ（cross-update / atomize / synthesize / lint） */}
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
