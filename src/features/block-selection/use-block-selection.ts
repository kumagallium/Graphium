// 複数ブロック選択を検知・管理するフック
// editor.getSelection() を監視し、2ブロック以上選択時にブロックIDリストを返す

import { useState, useEffect, useCallback, useRef } from "react";

type BlockSelectionState = {
  /** 選択中のブロックID（2ブロック以上のときのみ値が入る） */
  selectedBlockIds: string[];
  /**
   * ブロック丸ごとの選択（矩形選択・⠿ ドラッグの MultipleNodeSelection）か。
   * false は文字の上をドラッグした選択（TextSelection。どこからどこまでの文字かに意味がある）
   */
  blockMode: boolean;
  /** 選択をクリアする */
  clearSelection: () => void;
};

/**
 * ProseMirror の選択変更を監視し、複数ブロック選択状態を返す。
 * Shift+クリックによるブロック範囲選択もハンドリングする。
 */
export function useBlockSelection(editor: any): BlockSelectionState {
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [blockMode, setBlockMode] = useState(false);
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
      // 矩形選択・⠿ ドラッグ中の MultipleNodeSelection はブロック丸ごとの選択。
      // editor.getSelection() は終端（最後のブロックの直後）を次のブロックとして数えてしまうので、
      // 選択が持つノードから直接 ID を取る
      const pmSel = tiptap.state.selection;
      const isBlockSelection = pmSel?.toJSON?.().type === "multiple-node";
      const ids: string[] = isBlockSelection
        ? (pmSel.nodes ?? []).map((n: any) => n.attrs?.id).filter(Boolean)
        : (editor.getSelection?.()?.blocks ?? []).map((b: any) => b.id);
      if (ids.length >= 2) {
        setSelectedBlockIds(ids);
        setBlockMode(isBlockSelection);
      } else {
        setSelectedBlockIds([]);
        setBlockMode(false);
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

  return { selectedBlockIds, blockMode, clearSelection };
}
