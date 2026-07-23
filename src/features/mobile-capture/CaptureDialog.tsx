// 付箋テキスト入力ダイアログ
// variant により表示方法を切り替える:
//   - "fullscreen": モバイル向け。画面全体を占有しキーボードを最大化
//   - "centered":  デスクトップ向け。バックドロップ + 中央カード（軽量モーダル）

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send, Pilcrow } from "lucide-react";
import { useT } from "../../i18n";

export type CaptureDialogVariant = "fullscreen" | "centered";

export function CaptureDialog({
  onSubmit,
  onClose,
  submitting,
  variant = "fullscreen",
  contextLabel,
}: {
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  submitting: boolean;
  variant?: CaptureDialogVariant;
  /**
   * 紐付け先コンテキストの表示（optional）。
   * ブロック紐付きメモの場合に「どのブロックへのメモか」の抜粋を出す。
   */
  contextLabel?: string;
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

  // Ctrl/Cmd + Enter で送信、Escape で閉じる（centered のとき）
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
        return;
      }
      if (e.key === "Escape" && !submitting) {
        e.preventDefault();
        onClose();
      }
    },
    [handleSubmit, onClose, submitting]
  );

  if (variant === "centered") {
    // デスクトップ: バックドロップ + 中央カード。エディタの上にふわっと出る軽量入力。
    return (
      <div
        className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm pt-[15vh] px-4"
        onClick={() => { if (!submitting) onClose(); }}
      >
        <div
          className="w-full max-w-xl bg-background border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">
              {t("memo.new")}
            </h2>
            <button
              onClick={onClose}
              disabled={submitting}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
              aria-label={t("common.close")}
            >
              <X size={16} />
            </button>
          </div>

          {contextLabel && (
            <div className="flex items-center gap-1.5 px-4 pt-2.5 text-xs text-muted-foreground">
              <Pilcrow size={12} className="shrink-0" />
              <span className="truncate">{contextLabel}</span>
            </div>
          )}

          <div className="px-4 py-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("memo.placeholder")}
              disabled={submitting}
              rows={5}
              className="w-full resize-none bg-transparent text-foreground text-base placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/30">
            <p className="text-xs text-muted-foreground">
              {submitting ? t("memo.saving") : t("memo.hintDesktop")}
            </p>
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || submitting}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={12} />
              {t("memo.new")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // モバイル: 画面全体を占有するフルスクリーンモーダル
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

      {/* 紐付け先コンテキスト（ブロック紐付きメモの場合のみ） */}
      {contextLabel && (
        <div className="flex items-center gap-1.5 px-4 pt-2.5 text-xs text-muted-foreground">
          <Pilcrow size={12} className="shrink-0" />
          <span className="truncate">{contextLabel}</span>
        </div>
      )}

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
