// 複数ブロック選択時に表示されるフローティングツールバー
// 削除・色変更・AI連携の操作を提供する

import { useEffect, useRef, useState, useCallback } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { Trash2, Palette, Bot } from "lucide-react";
import { useAiAssistant } from "../ai-assistant";
import { useT } from "../../i18n";

// BlockNote の色定義
const BLOCK_COLORS = [
  { name: "default", label: "Default", value: "default", bg: "transparent" },
  { name: "gray", label: "Gray", value: "gray", bg: "#ebeced" },
  { name: "brown", label: "Brown", value: "brown", bg: "#e9e5e3" },
  { name: "red", label: "Red", value: "red", bg: "#fbe4e4" },
  { name: "orange", label: "Orange", value: "orange", bg: "#f6e9d9" },
  { name: "yellow", label: "Yellow", value: "yellow", bg: "#fbf3db" },
  { name: "green", label: "Green", value: "green", bg: "#ddedea" },
  { name: "blue", label: "Blue", value: "blue", bg: "#ddebf1" },
  { name: "purple", label: "Purple", value: "purple", bg: "#eae4f2" },
  { name: "pink", label: "Pink", value: "pink", bg: "#f4dfeb" },
] as const;

type SelectionToolbarProps = {
  selectedBlockIds: string[];
  onClear: () => void;
};

export function SelectionToolbar({ selectedBlockIds, onClear }: SelectionToolbarProps) {
  const editor = useBlockNoteEditor<any, any, any>();
  const aiAssistant = useAiAssistant();
  const t = useT();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showColors, setShowColors] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // 選択ブロックが変わったらツールバー位置を計算
  useEffect(() => {
    if (selectedBlockIds.length < 2) {
      setPosition(null);
      setShowColors(false);
      return;
    }

    // 最初の選択ブロックの上にツールバーを配置
    const firstBlockEl = document.querySelector(
      `[data-node-type="blockOuter"][data-id="${selectedBlockIds[0]}"]`
    );
    if (!firstBlockEl) {
      setPosition(null);
      return;
    }

    const rect = firstBlockEl.getBoundingClientRect();
    const editorEl = document.querySelector(".bn-editor");
    const editorRect = editorEl?.getBoundingClientRect();

    if (!editorRect) {
      setPosition(null);
      return;
    }

    setPosition({
      top: rect.top - editorRect.top - 44,
      left: rect.left - editorRect.left,
    });
  }, [selectedBlockIds]);

  // 一括削除
  const handleDelete = useCallback(() => {
    if (selectedBlockIds.length === 0) return;
    // BlockNote API で選択ブロックを削除
    editor.removeBlocks(
      selectedBlockIds.map((id: string) => ({ id }))
    );
    onClear();
  }, [editor, selectedBlockIds, onClear]);

  // 色変更
  const handleColor = useCallback((color: string) => {
    for (const id of selectedBlockIds) {
      editor.updateBlock(id, {
        props: {
          backgroundColor: color === "default" ? "default" : color,
        },
      });
    }
    setShowColors(false);
  }, [editor, selectedBlockIds]);

  // AI に選択ブロックを送信
  const handleAi = useCallback(async () => {
    if (selectedBlockIds.length === 0) return;
    const blocks = selectedBlockIds
      .map((id: string) => editor.getBlock(id))
      .filter((b: any): b is NonNullable<typeof b> => b != null);
    const markdown = await editor.blocksToMarkdownLossy(blocks as any);
    aiAssistant.openChat({
      sourceBlockIds: selectedBlockIds,
      quotedMarkdown: markdown,
    });
  }, [editor, selectedBlockIds, aiAssistant]);

  // Delete / Backspace キーハンドリング
  useEffect(() => {
    if (selectedBlockIds.length < 2) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        // テキスト入力中は無視（input/textarea 内）
        const active = document.activeElement;
        if (active?.tagName === "INPUT" || active?.tagName === "TEXTAREA") return;

        e.preventDefault();
        handleDelete();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedBlockIds, handleDelete]);

  if (!position || selectedBlockIds.length < 2) return null;

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 shadow-md"
      style={{ top: position.top, left: position.left }}
    >
      {/* 選択数表示 */}
      <span className="text-xs text-muted-foreground mr-1">
        {selectedBlockIds.length} blocks
      </span>

      {/* 削除 */}
      <button
        onClick={handleDelete}
        title={t("common.delete")}
        className="inline-flex items-center justify-center rounded p-1.5 hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors"
      >
        <Trash2 size={16} />
      </button>

      {/* 色変更 */}
      <div className="relative">
        <button
          onClick={() => setShowColors(!showColors)}
          title={t("common.color")}
          className="inline-flex items-center justify-center rounded p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Palette size={16} />
        </button>
        {showColors && (
          <div className="absolute top-full left-0 mt-1 flex flex-wrap gap-1 rounded-lg border border-border bg-white p-2 shadow-lg w-[140px]">
            {BLOCK_COLORS.map((c) => (
              <button
                key={c.name}
                onClick={() => handleColor(c.value)}
                title={c.label}
                className="w-6 h-6 rounded border border-border-subtle hover:scale-110 transition-transform"
                style={{
                  backgroundColor: c.bg === "transparent" ? "#fafdf7" : c.bg,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI アシスタント */}
      <button
        onClick={handleAi}
        title={t("editor.askAi")}
        className="inline-flex items-center justify-center rounded p-1.5 hover:bg-violet-50 text-muted-foreground hover:text-violet-500 transition-colors"
      >
        <Bot size={16} />
      </button>
    </div>
  );
}
