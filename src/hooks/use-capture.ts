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
  recordMemoKnowledged,
  archiveCapture,
  restoreCaptureFromArchive,
  trashCapture,
  restoreCaptureFromTrash,
  sendCaptureArchiveToTrash,
  generateCaptureId,
  clearCaptureCache,
  type CaptureIndex,
  type CaptureEntry,
  type MemoSourceAsset,
  type MemoSourceNote,
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
  // - sourceAsset: Quote→Memo 経路から呼ばれる場合の出典素材（optional）
  // - sourceNote: ノート右パネルの Memos タブから呼ばれる場合の出典ノート（optional）
  const handleCreateCapture = useCallback(async (
    text: string,
    sourceAsset?: MemoSourceAsset,
    sourceNote?: MemoSourceNote,
  ) => {
    setCapturing(true);
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const entry: CaptureEntry = {
        id: generateCaptureId(),
        text,
        createdAt: new Date().toISOString(),
        ...(sourceAsset ? { sourceAsset } : {}),
        ...(sourceNote ? { sourceNote } : {}),
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

  // 付箋のミューテーションを適用する共通処理（読み込み→変換→state 反映→永続化）
  const applyCaptureMutation = useCallback(
    async (mutate: (index: CaptureIndex) => CaptureIndex, errLabel: string) => {
      try {
        const current = indexRef.current ?? createEmptyCaptureIndex();
        const updated = mutate(current);
        indexRef.current = updated;
        setCaptureIndex(updated);
        await saveCaptureIndex(updated);
      } catch (err) {
        console.error(errLabel, err);
      }
    },
    [],
  );

  // メモを削除（ゴミ箱送り＝soft-delete。完全削除は handlePermanentDeleteCapture）
  const handleDeleteCapture = useCallback(
    (captureId: string) =>
      applyCaptureMutation((i) => trashCapture(i, captureId), "メモのゴミ箱送りに失敗:"),
    [applyCaptureMutation],
  );

  // メモを完全削除（ゴミ箱・アーカイブビューからの物理削除）
  const handlePermanentDeleteCapture = useCallback(
    (captureId: string) =>
      applyCaptureMutation((i) => removeCapture(i, captureId), "メモの完全削除に失敗:"),
    [applyCaptureMutation],
  );

  // メモをアーカイブ
  const handleArchiveCapture = useCallback(
    (captureId: string) =>
      applyCaptureMutation((i) => archiveCapture(i, captureId), "メモのアーカイブに失敗:"),
    [applyCaptureMutation],
  );

  // メモをアーカイブから復元（active に戻す）
  const handleRestoreCaptureFromArchive = useCallback(
    (captureId: string) =>
      applyCaptureMutation(
        (i) => restoreCaptureFromArchive(i, captureId),
        "メモのアーカイブ復元に失敗:",
      ),
    [applyCaptureMutation],
  );

  // メモをゴミ箱から復元（active に戻す）
  const handleRestoreCaptureFromTrash = useCallback(
    (captureId: string) =>
      applyCaptureMutation(
        (i) => restoreCaptureFromTrash(i, captureId),
        "メモのゴミ箱復元に失敗:",
      ),
    [applyCaptureMutation],
  );

  // アーカイブ済みメモをゴミ箱に送る
  const handleSendCaptureArchiveToTrash = useCallback(
    (captureId: string) =>
      applyCaptureMutation(
        (i) => sendCaptureArchiveToTrash(i, captureId),
        "メモのゴミ箱移動に失敗:",
      ),
    [applyCaptureMutation],
  );

  // メモのナレッジ化を記録（生成ノートへの逆リンク）
  const handleRecordKnowledged = useCallback(
    (captureId: string, noteId: string, noteTitle: string) =>
      applyCaptureMutation(
        (i) => recordMemoKnowledged(i, captureId, noteId, noteTitle),
        "メモのナレッジ化記録に失敗:",
      ),
    [applyCaptureMutation],
  );

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
    handlePermanentDeleteCapture,
    handleArchiveCapture,
    handleRestoreCaptureFromArchive,
    handleRestoreCaptureFromTrash,
    handleSendCaptureArchiveToTrash,
    handleRecordKnowledged,
    handleEditCapture,
    handleRecordUsage,
    refreshCaptures,
  };
}
