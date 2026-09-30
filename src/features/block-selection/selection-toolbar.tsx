// 複数ブロック選択時に表示されるフローティングツールバー
// 削除・色変更・AI連携の操作を提供する

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { Trash2, Palette, Bot } from "lucide-react";
import { useAiAssistant } from "../ai-assistant";
import { useBlockLifecycle } from "../block-lifecycle";
import { blocksToMarkdown } from "../markdown-export/blocks-to-markdown";
import { useTableMetaStoreOptional } from "../table-meta/store";
import { useT } from "../../i18n";
import { AnchoredPortal } from "../../ui/anchored-portal";
import { computeSelectionToolbarPosition, findFrameTop } from "./toolbar-position";

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
  const { removeBlockMetadata } = useBlockLifecycle();
  const tableMetaStore = useTableMetaStoreOptional();
  const t = useT();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showColors, setShowColors] = useState(false);
  const colorButtonRef = useRef<HTMLButtonElement>(null);
  // ビューポート座標（position:fixed）。null の間は測定前なので見せない
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // 選択ブロックが変わったら、選択を含むエディタを基準にツールバー位置を計算する。
  // （最初の .bn-editor を基準にすると、メインとサイドピークの 2 つがあるとき別のエディタで測ってしまう）
  // スクロール・リサイズでも測り直す
  useLayoutEffect(() => {
    if (selectedBlockIds.length < 2) {
      setPosition(null);
      setShowColors(false);
      return;
    }
    const blockEl = (id: string) =>
      document.querySelector(`[data-node-type="blockOuter"][data-id="${id}"]`);
    let raf = 0;
    const measure = () => {
      const firstEl = blockEl(selectedBlockIds[0]);
      const lastEl = blockEl(selectedBlockIds[selectedBlockIds.length - 1]) ?? firstEl;
      const toolbarEl = toolbarRef.current;
      if (!firstEl || !lastEl || !toolbarEl) {
        setPosition(null);
        return;
      }
      const f = firstEl.getBoundingClientRect();
      const l = lastEl.getBoundingClientRect();
      const tb = toolbarEl.getBoundingClientRect();
      const p = computeSelectionToolbarPosition({
        firstRect: { top: f.top, left: f.left, bottom: f.bottom, right: f.right },
        lastRect: { top: l.top, left: l.left, bottom: l.bottom, right: l.right },
        // 選択を含むエディタの、スクロールする枠の上端
        frameTop: findFrameTop(firstEl.closest(".bn-editor") ?? firstEl),
        toolbarSize: { width: tb.width, height: tb.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      setPosition((prev) =>
        prev && prev.top === p.top && prev.left === p.left ? prev : { top: p.top, left: p.left },
      );
    };
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    measure();
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [selectedBlockIds]);

  // 一括削除
  const handleDelete = useCallback(() => {
    if (selectedBlockIds.length === 0) return;
    // labels / provLinks を明示的にクリーンアップしてから削除
    // （onChange 経由の自動クリーンアップと二重でも idempotent）
    removeBlockMetadata(selectedBlockIds);
    editor.removeBlocks(
      selectedBlockIds.map((id: string) => ({ id }))
    );
    onClear();
  }, [editor, selectedBlockIds, onClear, removeBlockMetadata]);

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
    // 「表 N」の自動名は文書順で決まるので、番号付けはページ全体で行う
    const markdown = await blocksToMarkdown(editor, blocks, {
      tableMeta: tableMetaStore?.getSnapshot(),
      documentBlocks: editor.document,
    });
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

  if (selectedBlockIds.length < 2) return null;

  return (
    <div
      ref={toolbarRef}
      className="fixed flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 shadow-md"
      // 実寸を測って置くまでは見せない。ピーク（100）より上、色パレット・メニュー（9999）より下
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        zIndex: 9998,
        visibility: position ? undefined : "hidden",
      }}
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
          ref={colorButtonRef}
          onClick={() => setShowColors(!showColors)}
          title={t("common.color")}
          className="inline-flex items-center justify-center rounded p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Palette size={16} />
        </button>
        {showColors && (
          // 色パレットは body 直下へ出し、画面の内側に収める（位置は AnchoredPortal が決める）
          <AnchoredPortal
            anchor={colorButtonRef.current}
            className="flex flex-wrap gap-1 rounded-lg border border-border bg-white p-2 shadow-lg w-[140px]"
          >
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
          </AnchoredPortal>
        )}
      </div>

      {/* AI アシスタント（バックエンド不在時は非表示）。
          チャートブロックだけの選択でも隠す — チャートは参照設定しか持たず、
          AI に渡せる本文が無いため押しても意味のある結果にならない */}
      {aiAssistant.aiAvailable &&
        !selectedBlockIds.every((id) => editor.getBlock?.(id)?.type === "chart") && (
        <button
          onClick={handleAi}
          title={t("editor.askAi")}
          className="inline-flex items-center justify-center rounded p-1.5 hover:bg-violet-50 text-muted-foreground hover:text-violet-500 transition-colors"
        >
          <Bot size={16} />
        </button>
      )}
    </div>
  );
}
