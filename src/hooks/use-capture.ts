// 付箋キャプチャ管理 hook
// .graphium-captures.json の読み書きを行い、MobileCaptureView に状態を提供する

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readCaptureIndex,
  saveCaptureIndex,
  createEmptyCaptureIndex,
  addCapture,
  removeCapture,
  editCapture,
  recordMemoUsage,
  generateCaptureId,
  clearCaptureCache,
  type CaptureIndex,
  type CaptureEntry,
  type MemoSourceAsset,
} from "../features/mobile-capture";

export function useCapture(authenticated: boolean) {
  const [captureIndex, setCaptureIndex] = useState<CaptureIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const indexRef = useRef<CaptureIndex | null>(null);

  // 認証切り替え時にリセット
  useEffect(() => {
    if (!authenticated) {
      setCaptureIndex(null);
      indexRef.current = null;
      setLoading(true);
      clearCaptureCache();
    }
  }, [authenticated]);

  // 認証後にインデックスを読み込み
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const index = await readCaptureIndex();
        const resolved = index ?? createEmptyCaptureIndex();
        if (!cancelled) {
          indexRef.current = resolved;
          setCaptureIndex(resolved);
        }
      } catch (err) {
        console.error("キャプチャインデックスの読み込みに失敗:", err);
        if (!cancelled) {
          const empty = createEmptyCaptureIndex();
          indexRef.current = empty;
          setCaptureIndex(empty);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  // 付箋を作成
  // sourceAsset: Quote→Memo 経路から呼ばれる場合の出典素材（optional）
  const handleCreateCapture = useCallback(async (
    text: string,
    sourceAsset?: MemoSourceAsset,
  ) => {
    setCapturing(true);
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const entry: CaptureEntry = {
        id: generateCaptureId(),
        text,
        createdAt: new Date().toISOString(),
        ...(sourceAsset ? { sourceAsset } : {}),
      };
      const updated = addCapture(current, entry);
      indexRef.current = updated;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
    } catch (err) {
      console.error("キャプチャ作成に失敗:", err);
    } finally {
      setCapturing(false);
    }
  }, []);

  // 付箋を削除
  const handleDeleteCapture = useCallback(async (captureId: string) => {
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const updated = removeCapture(current, captureId);
      indexRef.current = updated;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
    } catch (err) {
      console.error("キャプチャ削除に失敗:", err);
    }
  }, []);

  // メモの挿入を記録
  const handleRecordUsage = useCallback(async (captureId: string, noteId: string, noteTitle: string) => {
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const updated = recordMemoUsage(current, captureId, noteId, noteTitle);
      indexRef.current = updated;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
    } catch (err) {
      console.error("メモ使用記録に失敗:", err);
    }
  }, []);

  // インデックスを再読み込み（Pull-to-Refresh 用）
  const refreshCaptures = useCallback(async () => {
    try {
      const index = await readCaptureIndex();
      const resolved = index ?? createEmptyCaptureIndex();
      indexRef.current = resolved;
      setCaptureIndex(resolved);
    } catch (err) {
      console.error("キャプチャ再読み込みに失敗:", err);
    }
  }, []);

  // メモのテキストを編集
  const handleEditCapture = useCallback(async (captureId: string, newText: string) => {
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const updated = editCapture(current, captureId, newText);
      indexRef.current = updated;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
    } catch (err) {
      console.error("メモ編集に失敗:", err);
    }
  }, []);

  return {
    captureIndex,
    captureLoading: loading,
    capturing,
    handleCreateCapture,
    handleDeleteCapture,
    handleEditCapture,
    handleRecordUsage,
    refreshCaptures,
  };
}
