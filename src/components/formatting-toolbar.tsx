// テキスト選択時の FormattingToolbar に AI ボタン（ドロップダウン）を追加

import { useCallback, useRef, useState } from "react";
import {
  FormattingToolbar,
  getFormattingToolbarItems,
  useBlockNoteEditor,
} from "@blocknote/react";
import { Bot, MessageSquare, RefreshCw, FileText, Languages, Pencil } from "lucide-react";
import { useAiAssistant } from "../features/ai-assistant";
import type { AiEditAction } from "../features/ai-assistant";
import { useT } from "../i18n";
import type { FormattingToolbarProps } from "@blocknote/react";

export function NoteFormattingToolbar(props: FormattingToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const aiAssistant = useAiAssistant();
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // 選択テキストとブロック ID を取得するヘルパー
  const getSelectionInfo = useCallback(() => {
    const selectedText = window.getSelection()?.toString()?.trim();
    if (!selectedText) return null;
    const selection = editor.getSelection();
    const blockIds = selection?.blocks?.map((b: any) => b.id) ?? [];
    return { selectedText, blockIds };
  }, [editor]);

  // 通常の AI チャット（質問モード）
  const handleAskAi = useCallback(() => {
    const info = getSelectionInfo();
    if (!info) return;
    aiAssistant.openChat({
      sourceBlockIds: info.blockIds,
      quotedMarkdown: info.selectedText,
    });
    setMenuOpen(false);
  }, [getSelectionInfo, aiAssistant]);

  // AI 編集アクション
  const handleEditAction = useCallback((action: AiEditAction) => {
    const info = getSelectionInfo();
    if (!info) return;
    aiAssistant.openEditChat({
      sourceBlockIds: info.blockIds,
      quotedMarkdown: info.selectedText,
      editMode: { action },
    });
    setMenuOpen(false);
    setShowCustomInput(false);
  }, [getSelectionInfo, aiAssistant]);

  // カスタム指示で編集
  const handleCustomSubmit = useCallback(() => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    const info = getSelectionInfo();
    if (!info) return;
    aiAssistant.openEditChat({
      sourceBlockIds: info.blockIds,
      quotedMarkdown: info.selectedText,
      editMode: { action: "custom", customInstruction: trimmed },
    });
    setMenuOpen(false);
    setShowCustomInput(false);
    setCustomInput("");
  }, [customInput, getSelectionInfo, aiAssistant]);

  return (
    <FormattingToolbar {...props}>
      {getFormattingToolbarItems(props.blockTypeSelectItems)}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((prev) => !prev)}
          title={t("editor.askAi")}
          className="bn-button inline-flex items-center justify-center rounded hover:bg-violet-100 text-violet-500 transition-colors"
          data-test="aiButton"
        >
          <Bot size={18} />
        </button>
        {menuOpen && (
          <>
            {/* 背景クリックで閉じる */}
            <div
              className="fixed inset-0 z-40"
              onClick={() => { setMenuOpen(false); setShowCustomInput(false); }}
            />
            <div className="absolute top-full right-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[180px]">
              <button
                onClick={handleAskAi}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
              >
                <MessageSquare size={13} className="text-violet-500" />
                {t("aiEdit.askAi")}
              </button>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => handleEditAction("rewrite")}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
              >
                <RefreshCw size={13} className="text-blue-500" />
                {t("aiEdit.rewrite")}
              </button>
              <button
                onClick={() => handleEditAction("summarize")}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
              >
                <FileText size={13} className="text-emerald-500" />
                {t("aiEdit.summarize")}
              </button>
              <button
                onClick={() => handleEditAction("translate")}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
              >
                <Languages size={13} className="text-amber-500" />
                {t("aiEdit.translate")}
              </button>
              <div className="border-t border-border my-1" />
              {showCustomInput ? (
                <div className="px-2 py-1">
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleCustomSubmit(); }}
                    placeholder={t("aiEdit.customPlaceholder")}
                    className="w-full text-xs px-2 py-1 border border-border rounded bg-background text-foreground"
                    autoFocus
                  />
                  <button
                    onClick={handleCustomSubmit}
                    disabled={!customInput.trim()}
                    className="mt-1 w-full text-xs px-2 py-1 bg-violet-500 text-white rounded hover:bg-violet-600 disabled:opacity-50 transition-colors"
                  >
                    {t("aiEdit.customSubmit")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCustomInput(true)}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
                >
                  <Pencil size={13} className="text-muted-foreground" />
                  {t("aiEdit.custom")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </FormattingToolbar>
  );
}
