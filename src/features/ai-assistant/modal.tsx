// AI アシスタントモーダル
// 引用ブロックの表示 + 質問入力 + 実行ボタン

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bot } from "lucide-react";
import { useAiAssistant } from "./store";

type AiAssistantModalProps = {
  /** AI に質問を実行する */
  onSubmit: (question: string) => void;
};

export function AiAssistantModal({ onSubmit }: AiAssistantModalProps) {
  const { isOpen, quotedMarkdown, loading, error, close } = useAiAssistant();
  const [question, setQuestion] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(() => {
    const trimmed = question.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  }, [question, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd/Ctrl + Enter で実行
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
      // Escape で閉じる
      if (e.key === "Escape") {
        close();
      }
    },
    [handleSubmit, close],
  );

  const handleClose = useCallback(() => {
    if (loading) return; // 実行中は閉じない
    setQuestion("");
    close();
  }, [loading, close]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      onMouseDown={(e) => {
        // 背景クリックで閉じる
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-black/40" />

      {/* モーダル本体 */}
      <div className="relative bg-background border border-border rounded-lg shadow-xl w-full max-w-xl mx-4 flex flex-col max-h-[80vh]">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot size={16} className="text-violet-500" />
            <h2 className="text-sm font-medium text-foreground">
              AI アシスタント
            </h2>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground text-lg leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {/* コンテンツ */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {/* 引用ブロック */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              📎 引用
            </label>
            <div className="bg-muted/50 border border-border rounded p-3 text-sm text-foreground/80 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
              {quotedMarkdown || "(引用なし)"}
            </div>
          </div>

          {/* 質問入力 */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              💬 質問
            </label>
            <textarea
              ref={textareaRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="この内容について質問を入力..."
              disabled={loading}
              autoFocus
              className="w-full bg-background border border-border rounded p-3 text-sm text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50 min-h-[80px]"
              rows={3}
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              ⌘+Enter で実行
            </div>
          </div>

          {/* エラー表示 */}
          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded p-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </div>

        {/* フッター */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={handleClose}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !question.trim()}
            className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {loading ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                実行中...
              </>
            ) : (
              "実行"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
