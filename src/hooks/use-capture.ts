// 付箋キャプチャ管理 hook
// .graphium-captures.json の読み書きを行い、MobileCaptureView に状態を提供する

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeNoteContexts } from "../features/note-context/context-tags";
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
  editCapturesContexts,
  remapCaptureContexts,
  type CaptureContextsEdit,
  type CaptureIndex,
  type CaptureEntry,
  type MemoSourceAsset,
  type MemoSourceNote,
  type MemoSourceEdge,
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
  // - sourceEdge: 作業手順・工程グラフの線に付けるメモの出典のつながり（optional。sourceNote も併せて渡す）
  // 戻り値は保存の成否（失敗しても throw はしない）。既存の呼び出し元は無視してよい。
  // 新しい入口（クイックメモ・選択ツールバー・素材一覧・小窓）は、失敗したとき
  // 右下のピルや書く欄の文の保持で利用者に知らせる。
  const handleCreateCapture = useCallback(async (
    text: string,
    sourceAsset?: MemoSourceAsset,
    sourceNote?: MemoSourceNote,
    folder?: string,
    sourceEdge?: MemoSourceEdge,
  ): Promise<boolean> => {
    setCapturing(true);
    let addedId: string | null = null;
    try {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      // 作成ダイアログで選んだフォルダ。最初からそのフォルダに入った状態にする
      const contexts = normalizeNoteContexts(folder ? [folder] : []);
      const entry: CaptureEntry = {
        id: generateCaptureId(),
        text,
        createdAt: new Date().toISOString(),
        ...(sourceAsset ? { sourceAsset } : {}),
        ...(sourceNote ? { sourceNote } : {}),
        ...(sourceEdge ? { sourceEdge } : {}),
        ...(contexts ? { noteContexts: contexts } : {}),
      };
      const updated = addCapture(current, entry);
      indexRef.current = updated;
      addedId = entry.id;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
      return true;
    } catch (err) {
      console.error("キャプチャ作成に失敗:", err);
      // 保存できなかったメモは一覧・件数から外す。書く欄は文を残すので、送り直しで二重にならないように
      // （並走して追加された別のメモは残すため、現在の索引から該当 ID だけ取り除く）
      if (addedId && indexRef.current) {
        const rolledBack = removeCapture(indexRef.current, addedId);
        indexRef.current = rolledBack;
        setCaptureIndex(rolledBack);
      }
      return false;
    } finally {
      setCapturing(false);
    }
  }, []);

  // モバイル受信箱からのメモ取り込み（インポート）。
  // handleCreateCapture と違い:
  // - createdAt にモバイルで書いた時刻を引き継ぐ（捕獲時刻の来歴を保つ。
  //   CaptureEntry の既存フィールドに値を渡すだけで、データ形式は変えない）
  // - 保存失敗は **throw する**（importer が failed に数え、Inbox のファイルを
  //   _imported/ へ動かさないので、次回の取り込みで再試行できる — データを落とさない）
  // 作成したメモの id を返す（取り込み結果レポート用）。
  const handleImportCapture = useCallback(
    async (text: string, createdAt?: string, folder?: string): Promise<string> => {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      // モバイルで選んだ「送り先」。届いた時点でそのフォルダに入っている状態にする
      const contexts = normalizeNoteContexts(folder ? [folder] : []);
      const entry: CaptureEntry = {
        id: generateCaptureId(),
        text,
        createdAt: createdAt ?? new Date().toISOString(),
        ...(contexts ? { noteContexts: contexts } : {}),
      };
      const updated = addCapture(current, entry);
      indexRef.current = updated;
      setCaptureIndex(updated);
      await saveCaptureIndex(updated);
      return entry.id;
    },
    [],
  );

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

  /**
   * メモ（複数可）のフォルダを付け外しする。値ではなく編集（関数）を受け取り、
   * 最新のインデックス（indexRef）に当てる — 画面に描いた時点の値から組んだ結果を渡すと、
   * ピッカーで「付けてすぐ外す」としたときに古い値で上書きされる。
   */
  const handleEditCaptureContexts = useCallback(
    async (captureIds: readonly string[], edit: CaptureContextsEdit) => {
      const current = indexRef.current;
      if (!current) return;
      const { index: updated, changed } = editCapturesContexts(current, captureIds, edit);
      if (changed === 0) return;
      indexRef.current = updated;
      setCaptureIndex(updated);
      try {
        await saveCaptureIndex(updated);
      } catch (err) {
        console.error("メモのフォルダ保存に失敗:", err);
      }
    },
    [],
  );

  /**
   * フォルダの改名 / 削除をメモにも波及させる（`to` が null なら取り除く）。
   * ノートだけ直してメモを取り残すと、同じフォルダのはずのメモが行方不明になる。
   * 直した件数を返す。
   */
  const remapCaptureContextsEverywhere = useCallback(
    async (from: string, to: string | null): Promise<number> => {
      const current = indexRef.current ?? createEmptyCaptureIndex();
      const { index: updated, changed } = remapCaptureContexts(current, from, to);
      if (changed === 0) return 0;
      indexRef.current = updated;
      setCaptureIndex(updated);
      try {
        await saveCaptureIndex(updated);
      } catch (err) {
        console.error("メモのフォルダ一括更新の保存に失敗:", err);
      }
      return changed;
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
    handleImportCapture,
    handleEditCaptureContexts,
    remapCaptureContextsEverywhere,
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
