// 付箋テキスト入力ダイアログ
// フルスクリーンモーダルで、テキストを入力して送信する

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";
import { useT } from "../../i18n";

export function CaptureDialog({
  onSubmit,
  onClose,
  submitting,
}: {
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  submitting: boolean;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const t = useT();

  // オープン時にフォーカス
  useEffect(() => {
    // モバイルキーボードが確実に表示されるよう少し遅延
    const timer = setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    await onSubmit(trimmed);
  }, [text, submitting, onSubmit]);

  // Ctrl/Cmd + Enter で送信
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* ヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button
          onClick={onClose}
          disabled={submitting}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <X size={20} />
        </button>
        <h2 className="text-sm font-semibold text-foreground">
          {t("memo.new")}
        </h2>
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors disabled:text-muted-foreground disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>

      {/* テキストエリア */}
      <div className="flex-1 px-4 py-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("memo.placeholder")}
          disabled={submitting}
          className="w-full h-full resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
        />
      </div>

      {/* フッターヒント */}
      <div className="px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-border">
        <p className="text-[10px] text-muted-foreground text-center">
          {submitting ? t("memo.saving") : t("memo.hint")}
        </p>
      </div>
    </div>
  );
}
