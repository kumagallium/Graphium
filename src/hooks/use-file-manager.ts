// ファイル管理 hook
// NoteApp のファイル一覧/キャッシュ/開く/新規/保存/削除/派生/グラフ/インデックスを集約

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listFiles,
  loadFile,
  createFile,
  saveFile,
  deleteFile,
  uploadMediaFileWithMeta,
  type ProvNoteFile,
  type ProvNoteDocument,
} from "../lib/google-drive";
import { PROV_TEMPLATE } from "../lib/prov-template";
import {
  buildNoteGraph,
  type NoteGraphData,
} from "../features/network-graph";
import {
  getRecentNotes,
  addToRecent,
  removeFromRecent,
  ensureIndex,
  updateIndexEntry,
  removeIndexEntry,
  saveIndexFile,
  type RecentNote,
  type ProvNoteIndex,
} from "../features/navigation";
import {
  saveMediaIndex,
  createEmptyIndex,
  addMediaEntry,
  removeMediaEntry,
  syncUsedIn,
  removeNoteFromUsedIn,
  deleteMediaFile,
  renameMediaFile,
  renameMediaEntry,
  extractMediaFromBlocks,
  mimeToMediaType,
  ensureMediaIndex,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaType,
} from "../features/asset-browser";

export function useFileManager(authenticated: boolean) {
  const [files, setFiles] = useState<ProvNoteFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [activeFileId, _setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  const setActiveFileId = useCallback((id: string | null) => {
    activeFileIdRef.current = id;
    _setActiveFileId(id);
    // 最後に開いたファイルを記録
    if (id) {
      localStorage.setItem("provnote_last_file", id);
    }
  }, []);
  const [activeDoc, setActiveDoc] = useState<ProvNoteDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // エディタを強制的にリマウントするためのキー
  const [editorKey, setEditorKey] = useState(0);
  // ノートキャッシュ（Drive API 呼び出しを削減）
  const docCacheRef = useRef<Map<string, ProvNoteDocument>>(new Map());
  // ネットワークグラフデータ
  const [noteGraphData, setNoteGraphData] = useState<NoteGraphData>({ nodes: [], edges: [] });
  // Split View 用の派生元ノート（NoteApp レベルで管理し、ファイル切り替えでも保持）
  const [sourceDoc, setSourceDoc] = useState<ProvNoteDocument | null>(null);
  // ノート一覧ビューの表示状態
  const [showNoteList, setShowNoteList] = useState(false);
  // 最近のノート履歴
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecentNotes());
  // ノートインデックス（.provnote-index.json）
  const [noteIndex, setNoteIndex] = useState<ProvNoteIndex | null>(null);
  const noteIndexRef = useRef<ProvNoteIndex | null>(null);
  // 派生ノート作成中フラグ
  const [deriving, setDeriving] = useState(false);
  // メディアインデックス（.provnote-media-index.json）
  const [mediaIndex, setMediaIndex] = useState<MediaIndex | null>(null);
  const mediaIndexRef = useRef<MediaIndex | null>(null);
  // アセットギャラリーの表示状態
  const [activeAssetType, setActiveAssetType] = useState<MediaType | null>(null);

  // ファイル一覧を取得
  const refreshFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const result = await listFiles();
      setFiles(result);
    } catch (err) {
      console.error("ファイル一覧の取得に失敗:", err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // ネットワークグラフを構築（全ノートの派生関係を取得）
  const rebuildGraph = useCallback(
    async (currentId: string | null, fileList: ProvNoteFile[]) => {
      if (!currentId || fileList.length === 0) {
        setNoteGraphData({ nodes: [], edges: [] });
        return;
      }
      // 未取得のノートをバックグラウンドで読み込み
      const missing = fileList.filter((f) => !docCacheRef.current.has(f.id));
      if (missing.length > 0) {
        const results = await Promise.allSettled(
          missing.map(async (f) => {
            const doc = await loadFile(f.id);
            docCacheRef.current.set(f.id, doc);
          })
        );
        // エラーは無視（削除済みファイルなど）
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(`ノート読み込みスキップ: ${missing[i].name}`);
          }
        });
      }
      setNoteGraphData(buildNoteGraph(currentId, fileList, docCacheRef.current));
    },
    []
  );

  // ファイルを開く（キャッシュ優先、cachedDoc が渡された場合はキャッシュを即時更新）
  const handleOpenFile = useCallback(async (fileId: string, cachedDoc?: ProvNoteDocument) => {
    try {
      // ノート一覧ビューを閉じる
      setShowNoteList(false);
      // サイドピーク等から保存済みドキュメントが渡された場合、キャッシュを即時更新
      if (cachedDoc) {
        docCacheRef.current.set(fileId, cachedDoc);
      }
      // キャッシュにあれば即座に表示
      const cached = docCacheRef.current.get(fileId);
      if (cached) {
        setActiveFileId(fileId);
        setActiveDoc(cached);
        setEditorKey((k) => k + 1);
        // 最近のノートに追加
        setRecentNotes(addToRecent(fileId, cached.title));
        // バックグラウンドで最新を取得してキャッシュ更新
        loadFile(fileId).then((doc) => docCacheRef.current.set(fileId, doc)).catch(() => {});
        return;
      }
      const doc = await loadFile(fileId);
      docCacheRef.current.set(fileId, doc);
      setActiveFileId(fileId);
      setActiveDoc(doc);
      setEditorKey((k) => k + 1);
      // 最近のノートに追加
      setRecentNotes(addToRecent(fileId, doc.title));
    } catch (err) {
      console.error("ファイルの読み込みに失敗:", err);
    }
  }, [setActiveFileId]);

  // 認証完了後にファイル一覧を取得し、インデックスを構築、最後に開いたファイルを復元
  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      await refreshFiles();
      const lastFileId = localStorage.getItem("provnote_last_file");
      if (lastFileId && !activeFileIdRef.current) {
        handleOpenFile(lastFileId);
      }
    })();
  }, [authenticated, refreshFiles, handleOpenFile]);

  // ファイル一覧が取得されたらインデックスを構築
  useEffect(() => {
    if (!authenticated || files.length === 0) return;
    let cancelled = false;
    (async () => {
      const index = await ensureIndex(files, docCacheRef.current);
      if (!cancelled) {
        noteIndexRef.current = index;
        setNoteIndex(index);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, files]);

  // メディアインデックスの初期構築（ノートインデックス構築後に実行）
  useEffect(() => {
    if (!authenticated || !noteIndex || files.length === 0) return;
    let cancelled = false;
    (async () => {
      const idx = await ensureMediaIndex(files, docCacheRef.current, loadFile);
      if (!cancelled) {
        mediaIndexRef.current = idx;
        setMediaIndex(idx);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, noteIndex, files]);

  // activeFileId や files が変わったらグラフを再構築
  useEffect(() => {
    if (activeFileId && files.length > 0) {
      rebuildGraph(activeFileId, files);
    }
  }, [activeFileId, files, rebuildGraph]);

  // 新しいノートを作成
  const handleNewNote = useCallback(() => {
    setActiveFileId(null);
    setActiveDoc(null);
    setEditorKey((k) => k + 1);
  }, [setActiveFileId]);

  // PROV テンプレートから作成
  const handleNewFromTemplate = useCallback(() => {
    setActiveFileId(null);
    setActiveDoc({
      ...PROV_TEMPLATE,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    });
    setEditorKey((k) => k + 1);
  }, [setActiveFileId]);

  // 保存（ref 経由で常に最新の activeFileId を使用）
  const handleSave = useCallback(
    async (doc: ProvNoteDocument) => {
      // 保存中なら二重実行しない
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        // 孤児リンクをクリーンアップ（存在しないノートへの参照を除去）
        const fileIds = new Set(files.map((f) => f.id));
        if (doc.noteLinks) {
          doc = { ...doc, noteLinks: doc.noteLinks.filter((l) => fileIds.has(l.targetNoteId)) };
          if (doc.noteLinks!.length === 0) doc = { ...doc, noteLinks: undefined };
        }
        if (doc.derivedFromNoteId && !fileIds.has(doc.derivedFromNoteId)) {
          doc = { ...doc, derivedFromNoteId: undefined, derivedFromBlockId: undefined };
        }

        const currentFileId = activeFileIdRef.current;
        if (currentFileId) {
          // 既存ファイルを上書き
          await saveFile(currentFileId, doc);
          // キャッシュも更新
          docCacheRef.current.set(currentFileId, doc);
          // ローカルのファイル一覧を即座に更新
          setFiles((prev) =>
            prev.map((f) =>
              f.id === currentFileId
                ? { ...f, name: `${doc.title}.provnote.json`, modifiedTime: new Date().toISOString() }
                : f
            )
          );
          // 最近のノートを更新
          setRecentNotes(addToRecent(currentFileId, doc.title));
        } else {
          // 新規作成
          const newId = await createFile(doc.title, doc);
          docCacheRef.current.set(newId, doc);
          setActiveDoc(doc);
          setActiveFileId(newId);
          // 最近のノートに追加
          setRecentNotes(addToRecent(newId, doc.title));
          // 新規ファイルを一覧に追加
          const newFile: ProvNoteFile = {
            id: newId,
            name: `${doc.title}.provnote.json`,
            modifiedTime: new Date().toISOString(),
            createdTime: new Date().toISOString(),
          };
          setFiles((prev) => [newFile, ...prev]);
        }

        // インデックスを差分更新
        if (noteIndexRef.current) {
          const savedFileId = currentFileId ?? activeFileIdRef.current;
          if (savedFileId) {
            const updated = updateIndexEntry(noteIndexRef.current, savedFileId, doc);
            noteIndexRef.current = updated;
            setNoteIndex(updated);
            saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
          }
        }

        // メディアインデックスの usedIn を同期
        if (mediaIndexRef.current) {
          const savedFileId = currentFileId ?? activeFileIdRef.current;
          if (savedFileId && doc.pages[0]) {
            const mediaMap = extractMediaFromBlocks(doc.pages[0].blocks || []);
            const updated = syncUsedIn(mediaIndexRef.current, savedFileId, doc.title, mediaMap);
            mediaIndexRef.current = updated;
            setMediaIndex(updated);
            saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
          }
        }
      } catch (err) {
        console.error("保存に失敗:", err);
        alert("保存に失敗しました。再度お試しください。");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [setActiveFileId, files]
  );

  // 派生ノートを別ファイルとして作成
  const handleDeriveNote = useCallback(
    async (derivedTitle: string, sourceBlockId: string) => {
      setDeriving(true);
      try {
        // 派生先ノートを作成
        const now = new Date().toISOString();
        const newDoc: ProvNoteDocument = {
          version: 2,
          title: `↳ ${derivedTitle}`,
          pages: [{ id: "main", title: `↳ ${derivedTitle}`, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
          derivedFromNoteId: activeFileIdRef.current ?? undefined,
          derivedFromBlockId: sourceBlockId,
          createdAt: now,
          modifiedAt: now,
        };
        const newFileId = await createFile(newDoc.title, newDoc);

        // 元ノートに noteLinks を追加して保存
        if (activeFileIdRef.current && activeDoc) {
          const noteLinks = activeDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId,
            type: "derived_from",
          });
          const updatedDoc = { ...activeDoc, noteLinks, modifiedAt: now };
          await saveFile(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `↳ ${derivedTitle}.provnote.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        // インデックスを更新（派生先ノート + 元ノート両方）
        if (noteIndexRef.current) {
          let updated = updateIndexEntry(noteIndexRef.current, newFileId, newDoc);
          if (activeFileIdRef.current && activeDoc) {
            updated = updateIndexEntry(updated, activeFileIdRef.current, activeDoc);
          }
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }

        // 派生先ノートを開く
        handleOpenFile(newFileId);
      } catch (err) {
        console.error("派生ノートの作成に失敗:", err);
      } finally {
        setDeriving(false);
      }
    },
    [activeDoc, handleOpenFile, setActiveFileId]
  );

  // AI 派生ノートを作成（構築済みの ProvNoteDocument を受け取って保存）
  const handleAiDeriveNote = useCallback(
    async (doc: ProvNoteDocument) => {
      setDeriving(true);
      try {
        const newFileId = await createFile(doc.title, doc);
        const now = new Date().toISOString();

        // 元ノートに noteLinks を追加して保存
        if (activeFileIdRef.current && activeDoc && doc.derivedFromBlockId) {
          const noteLinks = activeDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId: doc.derivedFromBlockId,
            type: "derived_from",
          });
          const updatedDoc = { ...activeDoc, noteLinks, modifiedAt: now };
          await saveFile(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `${doc.title}.provnote.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        // インデックスを更新
        if (noteIndexRef.current) {
          let updated = updateIndexEntry(noteIndexRef.current, newFileId, doc);
          if (activeFileIdRef.current && activeDoc) {
            updated = updateIndexEntry(updated, activeFileIdRef.current, activeDoc);
          }
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }

        // 派生先ノートを開く
        handleOpenFile(newFileId);
      } catch (err) {
        console.error("AI 派生ノートの作成に失敗:", err);
        throw err; // モーダル側でエラー表示
      } finally {
        setDeriving(false);
      }
    },
    [activeDoc, handleOpenFile, setActiveFileId],
  );

  // 削除（関連ノートのリンク情報もクリーンアップ）
  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        // 削除対象のドキュメントを取得
        const targetDoc = docCacheRef.current.get(fileId);

        if (targetDoc) {
          // 1. 派生元ノートの noteLinks から削除対象への参照を除去
          if (targetDoc.derivedFromNoteId) {
            const parentDoc = docCacheRef.current.get(targetDoc.derivedFromNoteId);
            if (parentDoc?.noteLinks) {
              const filtered = parentDoc.noteLinks.filter(
                (link) => link.targetNoteId !== fileId
              );
              const updatedParent = {
                ...parentDoc,
                noteLinks: filtered.length > 0 ? filtered : undefined,
                modifiedAt: new Date().toISOString(),
              };
              await saveFile(targetDoc.derivedFromNoteId, updatedParent);
              docCacheRef.current.set(targetDoc.derivedFromNoteId, updatedParent);
            }
          }

          // 2. 派生先ノートの derivedFromNoteId を除去
          if (targetDoc.noteLinks) {
            for (const link of targetDoc.noteLinks) {
              const childDoc = docCacheRef.current.get(link.targetNoteId);
              if (childDoc?.derivedFromNoteId === fileId) {
                const updatedChild = {
                  ...childDoc,
                  derivedFromNoteId: undefined,
                  derivedFromBlockId: undefined,
                  modifiedAt: new Date().toISOString(),
                };
                await saveFile(link.targetNoteId, updatedChild);
                docCacheRef.current.set(link.targetNoteId, updatedChild);
              }
            }
          }
        }

        // キャッシュから削除
        docCacheRef.current.delete(fileId);

        await deleteFile(fileId);
        // 最近のノートからも除去
        setRecentNotes(removeFromRecent(fileId));
        // インデックスから除去
        if (noteIndexRef.current) {
          const updated = removeIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        // メディアインデックスから usedIn を除去
        if (mediaIndexRef.current) {
          const updated = removeNoteFromUsedIn(mediaIndexRef.current, fileId);
          mediaIndexRef.current = updated;
          setMediaIndex(updated);
          saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
        }
        if (activeFileId === fileId) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
        await refreshFiles();
      } catch (err) {
        console.error("削除に失敗:", err);
      }
    },
    [activeFileId, refreshFiles, setActiveFileId]
  );

  // キャッシュからドキュメントを取得
  const getCachedDoc = useCallback(
    (noteId: string) => docCacheRef.current.get(noteId),
    []
  );

  // メディアアップロード（インデックス自動登録付き）
  const handleUploadMedia = useCallback(async (file: File): Promise<string> => {
    const result = await uploadMediaFileWithMeta(file);
    // メディアインデックスに登録
    const entry: MediaIndexEntry = {
      fileId: result.fileId,
      name: result.name,
      type: mimeToMediaType(result.mimeType),
      mimeType: result.mimeType,
      url: result.url,
      thumbnailUrl: result.url.replace("=s0", "=s200"),
      uploadedAt: new Date().toISOString(),
      usedIn: [],
    };
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated = addMediaEntry(current, entry);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
    return result.url;
  }, []);

  // メディアリネーム（モーダルから呼ぶ）
  const handleRenameMedia = useCallback(async (entry: MediaIndexEntry, newName: string) => {
    await renameMediaFile(entry.fileId, newName);
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated = renameMediaEntry(current, entry.fileId, newName);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
  }, []);

  // メディア削除（ギャラリーから呼ぶ）
  const handleDeleteMedia = useCallback(async (entry: MediaIndexEntry) => {
    await deleteMediaFile(entry.fileId);
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated = removeMediaEntry(current, entry.fileId);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
  }, []);

  return {
    // 状態
    files,
    filesLoading,
    activeFileId,
    activeDoc,
    saving,
    deriving,
    editorKey,
    noteGraphData,
    sourceDoc,
    setSourceDoc,
    showNoteList,
    setShowNoteList,
    recentNotes,
    noteIndex,
    mediaIndex,
    activeAssetType,
    setActiveAssetType,
    // アクション
    refreshFiles,
    handleOpenFile,
    handleNewNote,
    handleNewFromTemplate,
    handleSave,
    handleDeriveNote,
    handleAiDeriveNote,
    handleDelete,
    getCachedDoc,
    handleUploadMedia,
    handleDeleteMedia,
    handleRenameMedia,
  };
}
