// オートセーブ管理 hook
// dirty 管理、3秒デバウンス保存、Ctrl+S / Cmd+S ハンドラー

import { useCallback, useEffect, useRef, useState } from "react";

export function useAutoSave(onSave: () => void | Promise<void>) {
  const [dirty, setDirty] = useState(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSaveRef = useRef<() => void | Promise<void>>(() => {});

  // 常に最新の onSave を ref に保持
  useEffect(() => {
    handleSaveRef.current = onSave;
  }, [onSave]);

  // 保存実行 + dirty リセット
  const executeSave = useCallback(async () => {
    try {
      await handleSaveRef.current();
    } finally {
      setDirty(false);
    }
  }, []);

  // 変更をマーク → 3秒後に自動保存（ref 経由で常に最新の状態で保存）
  const markDirty = useCallback(() => {
    setDirty(true);
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      executeSave();
    }, 3000);
  }, [executeSave]);

  // 即時保存（タイマーをキャンセルして即実行）
  const saveNow = useCallback(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    executeSave();
  }, [executeSave]);

  // タイマーのクリーンアップ
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Ctrl+S / Cmd+S で保存（複数レベルでキャプチャ）
  // サイドピーク内にフォーカスがある場合はサイドピーク側に任せる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 素の ⌘S / Ctrl+S のみ。macOS Chrome は ⌘⇧S でも e.key が小文字 "s" のまま
      // 届くため、Shift / Alt を除外しないと「版を残す」(⌘⇧S / ⌘⌥S) をここが
      // window capture + stopPropagation で握り潰してしまう。
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        const sidePeekEl = document.querySelector("[data-side-peek]");
        if (sidePeekEl && sidePeekEl.contains(document.activeElement)) {
          return; // サイドピーク側のハンドラに委譲
        }
        e.preventDefault();
        e.stopPropagation();
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        executeSave();
      }
    };
    // document と window 両方でキャプチャフェーズに登録
    document.addEventListener("keydown", handler, { capture: true });
    window.addEventListener("keydown", handler, { capture: true });
    return () => {
      document.removeEventListener("keydown", handler, { capture: true });
      window.removeEventListener("keydown", handler, { capture: true });
    };
  }, []);

  return { dirty, setDirty, markDirty, saveNow };
}
