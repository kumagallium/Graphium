// 複数ブロック選択を検知・管理するフック
// editor.getSelection() を監視し、2ブロック以上選択時にブロックIDリストを返す

import { useState, useEffect, useCallback, useRef } from "react";

type BlockSelectionState = {
  /** 選択中のブロックID（2ブロック以上のときのみ値が入る） */
  selectedBlockIds: string[];
  /** 選択をクリアする */
  clearSelection: () => void;
};

/**
 * ProseMirror の選択変更を監視し、複数ブロック選択状態を返す。
 * Shift+クリックによるブロック範囲選択もハンドリングする。
 */
export function useBlockSelection(editor: any): BlockSelectionState {
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  // Shift+クリック: 最後にカーソルがあったブロックID
  const lastCursorBlockRef = useRef<string | null>(null);

  const clearSelection = useCallback(() => {
    setSelectedBlockIds([]);
  }, []);

  // エディタの選択変更を監視
  useEffect(() => {
    if (!editor?._tiptapEditor) return;

    const tiptap = editor._tiptapEditor;

    const handleUpdate = () => {
      // IME 変換中（composition）は state を触らない。
      // テキスト挿入トランザクションごとに React re-render が走ると、
      // 日本語入力の確定タイミングと競合して文字が重複・改行が乱れる。
      if (tiptap.view?.composing) return;
      const selection = editor.getSelection?.();
      if (selection && selection.blocks && selection.blocks.length >= 2) {
        const ids = selection.blocks.map((b: any) => b.id);
        setSelectedBlockIds(ids);
      } else {
        setSelectedBlockIds([]);
        // 単一カーソル位置を記録（Shift+クリック用）
        const cursor = editor.getTextCursorPosition?.();
        if (cursor?.block) {
          lastCursorBlockRef.current = cursor.block.id;
        }
      }
    };

    // 複数ブロック選択は「選択範囲が変わった瞬間」だけ気にすれば足りる。
    // `transaction` は文字挿入のたびにも発火し、IME 中に大量に呼ばれて
    // composition を乱す。selectionUpdate のみに絞る。
    tiptap.on("selectionUpdate", handleUpdate);

    return () => {
      tiptap.off("selectionUpdate", handleUpdate);
    };
  }, [editor]);

  // Shift+クリックでブロック範囲選択
  useEffect(() => {
    if (!editor?._tiptapEditor) return;

    const editorEl = editor._tiptapEditor.view?.dom as HTMLElement | undefined;
    if (!editorEl) return;

    const handleClick = (e: MouseEvent) => {
      if (!e.shiftKey) return;
      if (!lastCursorBlockRef.current) return;

      // クリック位置のブロックを特定
      const target = e.target as HTMLElement;
      const blockOuter = target.closest("[data-node-type='blockOuter']") as HTMLElement | null;
      if (!blockOuter) return;

      const clickedBlockId = blockOuter.getAttribute("data-id");
      if (!clickedBlockId || clickedBlockId === lastCursorBlockRef.current) return;

      // editor.setSelection で範囲選択を設定
      try {
        editor.setSelection(lastCursorBlockRef.current, clickedBlockId);
        e.preventDefault();
      } catch {
        // ブロックが見つからない場合は無視
      }
    };

    editorEl.addEventListener("click", handleClick);
    return () => editorEl.removeEventListener("click", handleClick);
  }, [editor]);

  return { selectedBlockIds, clearSelection };
}
