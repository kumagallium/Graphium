// 付箋テキスト入力ダイアログ
// variant により表示方法を切り替える:
//   - "fullscreen": モバイル向け。画面全体を占有しキーボードを最大化
//   - "centered":  デスクトップ向け。バックドロップ + 中央カード（軽量モーダル）

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Send, Pilcrow, Folder as FolderIcon } from "lucide-react";
import { useT } from "../../i18n";

export type CaptureDialogVariant = "fullscreen" | "centered";

/** select の「新しいフォルダ…」を表す番兵。フォルダ名には現れない形 */
const NEW_FOLDER_OPTION = "\u0000new";

export function CaptureDialog({
  onSubmit,
  onClose,
  submitting,
  variant = "fullscreen",
  contextLabel,
  folderOptions,
  defaultFolder,
}: {
  /** 本文と、選んだフォルダ（未選択なら undefined）。 */
  onSubmit: (text: string, folder?: string) => Promise<void>;
  onClose: () => void;
  submitting: boolean;
  variant?: CaptureDialogVariant;
  /**
   * 紐付け先コンテキストの表示（optional）。
   * ブロック紐付きメモの場合に「どのブロックへのメモか」の抜粋を出す。
   */
  contextLabel?: string;
  /**
   * フォルダの候補（centered のみ）。渡されたときだけ選択欄を出す。
   * モバイルは画面上部の「送り先」で選ぶので、ここでは出さない。
   */
  folderOptions?: readonly string[];
  /** 最初から入っているフォルダ。「今見ているもののフォルダ」を呼び出し側が渡す */
  defaultFolder?: string;
}) {
  const [text, setText] = useState("");
  const [folder, setFolder] = useState(defaultFolder ?? "");
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolder, setNewFolder] = useState("");
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
    await onSubmit(trimmed, folder.trim() || undefined);
  }, [text, folder, submitting, onSubmit]);

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
            <div className="flex items-center gap-2">
              {/* どこへ入るかは、押す前にボタンの隣で見えているのが筋。
                  フォーカスは奪わない — ⌘+Enter の速さを損なわない */}
              {folderOptions && (
                <div className="flex items-center gap-1.5">
                  <FolderIcon size={12} className="shrink-0 text-muted-foreground" />
                  {addingFolder ? (
                    <input
                      autoFocus
                      type="text"
                      value={newFolder}
                      onChange={(e) => setNewFolder(e.target.value)}
                      onBlur={() => {
                        if (newFolder.trim()) setFolder(newFolder.trim());
                        setAddingFolder(false);
                        setNewFolder("");
                      }}
                      onKeyDown={(e) => {
                        // Enter で確定。ダイアログ側の ⌘+Enter とは別なので伝播を止める
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          if (newFolder.trim()) setFolder(newFolder.trim());
                          setAddingFolder(false);
                          setNewFolder("");
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setAddingFolder(false);
                          setNewFolder("");
                        }
                      }}
                      placeholder={t("folderPicker.placeholder")}
                      className="w-40 text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                    />
                  ) : (
                    <select
                      value={folder}
                      onChange={(e) => {
                        if (e.target.value === NEW_FOLDER_OPTION) {
                          setNewFolder("");
                          setAddingFolder(true);
                          return;
                        }
                        setFolder(e.target.value);
                      }}
                      aria-label={t("nav.folders")}
                      className="max-w-40 text-xs px-2 py-1 rounded-md border border-border bg-background text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{t("folderPicker.none")}</option>
                      {/* 候補に無い値（新規入力）が入っていても選択状態を保つ */}
                      {folder && !folderOptions.includes(folder) && (
                        <option value={folder}>{folder}</option>
                      )}
                      {folderOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                      <option value={NEW_FOLDER_OPTION}>{t("folderPicker.new")}</option>
                    </select>
                  )}
                </div>
              )}
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
