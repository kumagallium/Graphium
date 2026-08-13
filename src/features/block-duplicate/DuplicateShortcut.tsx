// ⌘D / Ctrl+D でカーソル位置のブロックを直下に複製する。
//
// BlockNoteView の子として置き、エディタの DOM に capture で keydown を張る
// （ブラウザ既定のブックマーク追加より先に取るため）。エディタの外では効かない。
//
// ProseMirror の selection は selectionchange 経由の非同期同期なので、矢印キー直後の
// ⌘D で 1 手古いブロックを掴まないよう、判定前に domObserver.flush() する。

import { useEffect } from "react";
import { useBlockNoteEditor } from "@blocknote/react";
import { useDuplicateBlocks } from "./use-duplicate-blocks";

export function DuplicateShortcut() {
  const editor = useBlockNoteEditor<any, any, any>();
  const duplicate = useDuplicateBlocks();

  useEffect(() => {
    const view = (editor as any)?._tiptapEditor?.view;
    const dom: HTMLElement | undefined = view?.dom;
    if (!dom) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      // mac は ⌘D、Windows / Linux は Ctrl+D。⌥/Shift 併用は別操作の余地を残して無視。
      const primary = e.metaKey || e.ctrlKey;
      if (!primary || e.altKey || e.shiftKey) return;
      if (editor.isEditable === false) return;

      try {
        view?.domObserver?.flush?.();
      } catch {
        /* flush できない環境（テスト等）では現在の selection をそのまま使う */
      }
      const block = editor.getTextCursorPosition?.()?.block;
      if (!block) return;

      e.preventDefault();
      e.stopPropagation();
      duplicate([block.id]);
    };

    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
  }, [editor, duplicate]);

  return null;
}
