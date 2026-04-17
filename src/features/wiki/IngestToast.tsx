// Ingest 処理中のトースト通知
// 処理中はスピナー表示、完了/エラー時にメッセージ表示後に自動消滅

import { useEffect, useState } from "react";
import { Bot, Check, X, Loader2 } from "lucide-react";

export type IngestToastState = {
  status: "loading" | "success" | "error";
  message: string;
} | null;

type Props = {
  state: IngestToastState;
  onDismiss: () => void;
};

export function IngestToast({ state, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (state) {
      setVisible(true);
      // 成功・エラー時は 4 秒後に自動消滅
      if (state.status !== "loading") {
        const timer = setTimeout(() => {
          setVisible(false);
          setTimeout(onDismiss, 300);
        }, 4000);
        return () => clearTimeout(timer);
      }
    } else {
      setVisible(false);
    }
  }, [state, onDismiss]);

  if (!state) return null;

  const bgColor = state.status === "error"
    ? "bg-destructive/10 border-destructive/20"
    : state.status === "success"
    ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-800"
    : "bg-popover border-border";

  const icon = state.status === "loading"
    ? <Loader2 size={16} className="animate-spin text-primary" />
    : state.status === "success"
    ? <Check size={16} className="text-emerald-600" />
    : <X size={16} className="text-destructive" />;

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg transition-all duration-300 ${bgColor} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
      }`}
    >
      {icon}
      <div className="flex items-center gap-2">
        <Bot size={14} className="text-muted-foreground" />
        <span className="text-sm text-foreground">{state.message}</span>
      </div>
      {state.status !== "loading" && (
        <button
          onClick={() => { setVisible(false); setTimeout(onDismiss, 300); }}
          className="text-muted-foreground hover:text-foreground ml-2"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
