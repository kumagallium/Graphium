// ファイル管理 hook
// NoteApp のファイル一覧/キャッシュ/開く/新規/保存/削除/派生/グラフ/インデックスを集約

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphiumFile, GraphiumDocument, WikiKind } from "../lib/document-types";
import { getActiveProvider } from "../lib/storage/registry";
import { PROV_TEMPLATE } from "../lib/prov-template";
import { recordRevision } from "../features/document-provenance/tracker";
import {
  buildNoteGraph,
  type NoteGraphData,
} from "../features/network-graph";
import {
  getRecentNotes,
  addToRecent,
  removeFromRecent,
  ensureIndex,
  readIndexFile,
  updateIndexEntry,
  removeIndexEntry,
  saveIndexFile,
  buildIndexEntry,
  type RecentNote,
  type GraphiumIndex,
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
  updateBlockNameByUrl,
  mimeToMediaType,
  readMediaIndex,
  ensureMediaIndex,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaType,
} from "../features/asset-browser";

// ストレージプロバイダー経由のファイル操作ヘルパー
const storage = () => getActiveProvider();
const listFiles = () => storage().listFiles();
const loadFile = (id: string) => storage().loadFile(id);
const createFile = (title: string, content: GraphiumDocument) => storage().createFile(title, content);
const saveFile = (id: string, content: GraphiumDocument) => storage().saveFile(id, content);
const deleteFile = (id: string) => storage().deleteFile(id);
const uploadMediaFileWithMeta = (file: File) => storage().uploadMedia(file);
// Wiki ドキュメント操作ヘルパー
const listWikiFiles = () => storage().listWikiFiles?.() ?? Promise.resolve([]);
const loadWikiFile = (id: string) => {
  if (!storage().loadWikiFile) throw new Error("Wiki 非対応のストレージプロバイダーです");
  return storage().loadWikiFile!(id);
};
const createWikiFile = (title: string, content: GraphiumDocument) => {
  if (!storage().createWikiFile) throw new Error("Wiki 非対応のストレージプロバイダーです");
  return storage().createWikiFile!(title, content);
};
const saveWikiFile = (id: string, content: GraphiumDocument) => {
  if (!storage().saveWikiFile) throw new Error("Wiki 非対応のストレージプロバイダーです");
  return storage().saveWikiFile!(id, content);
};
const deleteWikiFileFromStorage = (id: string) => {
  if (!storage().deleteWikiFile) throw new Error("Wiki 非対応のストレージプロバイダーです");
  return storage().deleteWikiFile!(id);
};
// Skill ドキュメント操作ヘルパー
const listSkillFiles = () => storage().listSkillFiles?.() ?? Promise.resolve([]);
const loadSkillFile = (id: string) => {
  if (!storage().loadSkillFile) throw new Error("Skill 非対応のストレージプロバイダーです");
  return storage().loadSkillFile!(id);
};
const createSkillFile = (title: string, content: GraphiumDocument) => {
  if (!storage().createSkillFile) throw new Error("Skill 非対応のストレージプロバイダーです");
  return storage().createSkillFile!(title, content);
};
const saveSkillFile = (id: string, content: GraphiumDocument) => {
  if (!storage().saveSkillFile) throw new Error("Skill 非対応のストレージプロバイダーです");
  return storage().saveSkillFile!(id, content);
};
const deleteSkillFileFromStorage = (id: string) => {
  if (!storage().deleteSkillFile) throw new Error("Skill 非対応のストレージプロバイダーです");
  return storage().deleteSkillFile!(id);
};

export function useFileManager(authenticated: boolean) {
  const [files, setFiles] = useState<GraphiumFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true); // 初回読み込み待ち
  const [activeFileId, _setActiveFileId] = useState<string | null>(null);
  const activeFileIdRef = useRef<string | null>(null);
  const setActiveFileId = useCallback((id: string | null) => {
    activeFileIdRef.current = id;
    _setActiveFileId(id);
    // 最後に開いたファイルを記録
    if (id) {
      localStorage.setItem("graphium_last_file", id);
    }
  }, []);
  const [activeDoc, setActiveDoc] = useState<GraphiumDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // エディタを強制的にリマウントするためのキー
  const [editorKey, setEditorKey] = useState(0);
  // ノートキャッシュ（Drive API 呼び出しを削減）
  const docCacheRef = useRef<Map<string, GraphiumDocument>>(new Map());
  // ネットワークグラフデータ
  const [noteGraphData, setNoteGraphData] = useState<NoteGraphData>({ nodes: [], edges: [] });
  // Split View 用の派生元ノート（NoteApp レベルで管理し、ファイル切り替えでも保持）
  const [sourceDoc, setSourceDoc] = useState<GraphiumDocument | null>(null);
  // ノート一覧ビューの表示状態
  const [showNoteList, setShowNoteList] = useState(false);
  // 最近のノート履歴
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecentNotes());
  // ノートインデックス（.graphium-index.json）
  const [noteIndex, setNoteIndex] = useState<GraphiumIndex | null>(null);
  const noteIndexRef = useRef<GraphiumIndex | null>(null);
  // 派生ノート作成中フラグ
  const [deriving, setDeriving] = useState(false);
  // メディアインデックス（.graphium-media-index.json）
  const [mediaIndex, setMediaIndex] = useState<MediaIndex | null>(null);
  const mediaIndexRef = useRef<MediaIndex | null>(null);
  // アセットギャラリーの表示状態
  const [activeAssetType, setActiveAssetType] = useState<MediaType | null>(null);
  // ラベルギャラリーの表示状態
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  // Wiki 関連の状態
  const [wikiFiles, setWikiFiles] = useState<GraphiumFile[]>([]);
  const [activeWikiKind, setActiveWikiKind] = useState<WikiKind | null>(null);
  // Wiki メタデータ（サイドバーカウント・リスト表示用、noteIndex とは独立）
  const [wikiMetas, setWikiMetas] = useState<Map<string, { title: string; kind: WikiKind; headings: string[] }>>(new Map());
  // Skill 関連の状態
  const [skillFiles, setSkillFiles] = useState<GraphiumFile[]>([]);
  const [skillMetas, setSkillMetas] = useState<Map<string, { title: string; description: string; availableForIngest: boolean }>>(new Map());

  // ファイル一覧を取得（ノートと Wiki と Skill を並列取得）
  const refreshFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [noteResult, wikiResult, skillResult] = await Promise.all([
        listFiles(),
        listWikiFiles(),
        listSkillFiles(),
      ]);
      console.log(`[wiki-debug] refreshFiles: notes=${noteResult.length}, wikis=${wikiResult.length}`, wikiResult.map(f => f.id));
      setFiles(noteResult);
      setWikiFiles(wikiResult);
      setSkillFiles(skillResult);
      // Skill メタデータをバックグラウンドで読み込み
      if (skillResult.length > 0) {
        Promise.allSettled(
          skillResult.map(async (f) => {
            const doc = await loadSkillFile(f.id);
            return { id: f.id, doc };
          })
        ).then((results) => {
          const metas = new Map<string, { title: string; description: string; availableForIngest: boolean }>();
          for (const r of results) {
            if (r.status === "fulfilled") {
              const { id, doc } = r.value;
              metas.set(id, {
                title: doc.title,
                description: doc.skillMeta?.description ?? "",
                availableForIngest: doc.skillMeta?.availableForIngest ?? true,
              });
              docCacheRef.current.set(`skill:${id}`, doc);
            }
          }
          setSkillMetas(metas);
        });
      }
      // Wiki メタデータをバックグラウンドで読み込み（サイドバーカウント・リスト表示用）
      if (wikiResult.length > 0) {
        Promise.allSettled(
          wikiResult.map(async (f) => {
            const doc = await loadWikiFile(f.id);
            return { id: f.id, doc };
          })
        ).then((results) => {
          const metas = new Map<string, { title: string; kind: WikiKind; headings: string[] }>();
          for (const r of results) {
            if (r.status === "fulfilled") {
              const { id, doc } = r.value;
              const headings = (doc.pages[0]?.blocks ?? [])
                .filter((b: any) => b.type === "heading" && b.props?.level === 2)
                .map((b: any) => {
                  if (Array.isArray(b.content)) return b.content.map((c: any) => c.text ?? "").join("");
                  return "";
                })
                .filter(Boolean);
              metas.set(id, {
                title: doc.title,
                kind: doc.wikiMeta?.kind ?? "concept",
                headings,
              });
              docCacheRef.current.set(`wiki:${id}`, doc);
            }
          }
          setWikiMetas(metas);
        });
      }
    } catch (err) {
      console.error("ファイル一覧の取得に失敗:", err);
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // メディアインデックスを再読み込み（Pull-to-Refresh 用）
  const refreshMediaIndex = useCallback(async () => {
    try {
      const idx = await readMediaIndex();
      if (idx) {
        mediaIndexRef.current = idx;
        setMediaIndex(idx);
      }
    } catch (err) {
      console.error("メディアインデックスの再読み込みに失敗:", err);
    }
  }, []);

  // ネットワークグラフを構築（全ノートの派生関係を取得）
  const rebuildGraph = useCallback(
    async (currentId: string | null, fileList: GraphiumFile[]) => {
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
  const handleOpenFile = useCallback(async (fileId: string, cachedDoc?: GraphiumDocument) => {
    try {
      // ノート一覧・ギャラリービューを閉じる
      setShowNoteList(false);
      setActiveAssetType(null);
      setActiveLabel(null);
      setActiveWikiKind(null);
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

  // 認証が切れたら全 state をリセット（プロバイダー切り替え時に古いデータが残るのを防ぐ）
  useEffect(() => {
    if (!authenticated) {
      setFiles([]);
      setFilesLoading(true); // 次回認証時にインデックスが空で確定しないようにする
      setNoteIndex(null);
      noteIndexRef.current = null;
      setMediaIndex(null);
      mediaIndexRef.current = null;
      setActiveDoc(null);
      setSourceDoc(null);
      _setActiveFileId(null);
      activeFileIdRef.current = null;
      docCacheRef.current.clear();
      setNoteGraphData({ nodes: [], edges: [] });
    }
  }, [authenticated]);

  // 認証完了後にファイル一覧を取得し、インデックスを構築、最後に開いたファイルを復元
  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      await refreshFiles();
      const lastFileId = localStorage.getItem("graphium_last_file");
      // モバイル（768px 未満）ではキャプチャビューをデフォルトにするため、最後のファイルを復元しない
      const isMobile = window.innerWidth < 768;
      if (lastFileId && !activeFileIdRef.current && !isMobile) {
        // ファイル一覧に存在するか確認（ゴミ箱内のファイルを開かないようにする）
        const currentFiles = await listFiles();
        if (currentFiles.some((f) => f.id === lastFileId)) {
          handleOpenFile(lastFileId);
        } else {
          localStorage.removeItem("graphium_last_file");
        }
      }
    })();
  }, [authenticated, refreshFiles, handleOpenFile]);

  // インデックスの先行読み込み（listFiles と並列実行）
  const prefetchedIndexRef = useRef<Promise<GraphiumIndex | null> | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    // listFiles と同時にインデックスファイルの読み込みを開始
    prefetchedIndexRef.current = readIndexFile().catch(() => null);
  }, [authenticated]);

  // ファイル一覧が取得されたらインデックスを構築（先行読み込み結果を利用）
  useEffect(() => {
    if (!authenticated) return;
    if (filesLoading) return; // ファイル一覧取得中はインデックス構築をスキップ
    if (files.length === 0 && wikiFiles.length === 0) {
      // ノートも Wiki もない場合は空のインデックスをセット
      const emptyIndex: GraphiumIndex = { version: 4, updatedAt: new Date().toISOString(), notes: [] };
      noteIndexRef.current = emptyIndex;
      setNoteIndex(emptyIndex);
      return;
    }
    let cancelled = false;
    (async () => {
      // 先行読み込みの結果を取得（listFiles と並行して既に読み込み済み）
      const prefetched = prefetchedIndexRef.current ? await prefetchedIndexRef.current : undefined;
      // ノートのインデックスを構築
      const index = files.length > 0
        ? await ensureIndex(files, docCacheRef.current, prefetched)
        : { version: 4, updatedAt: new Date().toISOString(), notes: [] } as GraphiumIndex;

      // Wiki ファイルのインデックスエントリを追加
      // 既存インデックスから古い Wiki エントリを除去し、最新の wikiFiles から再構築する
      if (wikiFiles.length > 0) {
        // まず既存の Wiki エントリを除去（ノートエントリだけ残す）
        index.notes = index.notes.filter((n) => n.source !== "ai");

        const wikiDocs = await Promise.allSettled(
          wikiFiles.map(async (f) => {
            const doc = await loadWikiFile(f.id);
            return { file: f, doc };
          })
        );
        for (const result of wikiDocs) {
          if (result.status === "fulfilled") {
            const { file, doc } = result.value;
            const entry = buildIndexEntry(file.id, doc, file);
            index.notes.push(entry);
          }
        }
        index.updatedAt = new Date().toISOString();
        // Wiki 込みのインデックスを永続化
        saveIndexFile(index).catch((err) => console.warn("インデックス保存失敗:", err));
      } else {
        // Wiki が無い場合も、古い Wiki エントリが残っていたら除去
        const hadWiki = index.notes.some((n) => n.source === "ai");
        if (hadWiki) {
          index.notes = index.notes.filter((n) => n.source !== "ai");
          index.updatedAt = new Date().toISOString();
          saveIndexFile(index).catch((err) => console.warn("インデックス保存失敗:", err));
        }
      }

      if (!cancelled) {
        noteIndexRef.current = index;
        setNoteIndex(index);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, files, wikiFiles, filesLoading]);

  // メディアインデックスの先行読み込み（既存ファイルから即座に取得 — モバイル高速表示用）
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      try {
        const idx = await readMediaIndex();
        if (!cancelled && idx && !mediaIndexRef.current) {
          mediaIndexRef.current = idx;
          setMediaIndex(idx);
        }
      } catch {
        // 先行読み込み失敗は無視（後続の ensureMediaIndex で構築される）
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  // メディアインデックスの完全構築（ノートインデックス構築後に実行、先行読み込みを上書き）
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
    // ギャラリービューを閉じる
    setActiveAssetType(null);
    setActiveLabel(null);
    setShowNoteList(false);
  }, [setActiveFileId]);

  // PROV テンプレートから作成
  const handleNewFromTemplate = useCallback(async () => {
    setActiveFileId(null);
    // ギャラリービューを閉じる
    setActiveAssetType(null);
    setActiveLabel(null);
    setShowNoteList(false);
    let doc: GraphiumDocument = {
      ...PROV_TEMPLATE,
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    };
    // ドキュメント来歴: テンプレート作成を記録
    doc = await recordRevision(doc, null, "template_create");
    setActiveDoc(doc);
    setEditorKey((k) => k + 1);
  }, [setActiveFileId]);

  // 保存（ref 経由で常に最新の activeFileId を使用）
  const handleSave = useCallback(
    async (doc: GraphiumDocument) => {
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
        // ファイル一覧に存在するか確認（ゴミ箱内のファイルへの保存を防止）
        const fileExists = currentFileId && files.some((f) => f.id === currentFileId);
        if (currentFileId && fileExists) {
          // 既存ファイルを上書き
          await saveFile(currentFileId, doc);
          // キャッシュも更新
          docCacheRef.current.set(currentFileId, doc);
          // ローカルのファイル一覧を即座に更新
          setFiles((prev) =>
            prev.map((f) =>
              f.id === currentFileId
                ? { ...f, name: `${doc.title}.graphium.json`, modifiedTime: new Date().toISOString() }
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
          const newFile: GraphiumFile = {
            id: newId,
            name: `${doc.title}.graphium.json`,
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
        let newDoc: GraphiumDocument = {
          version: 2,
          title: `↳ ${derivedTitle}`,
          pages: [{ id: "main", title: `↳ ${derivedTitle}`, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
          derivedFromNoteId: activeFileIdRef.current ?? undefined,
          derivedFromBlockId: sourceBlockId,
          createdAt: now,
          modifiedAt: now,
        };
        // ドキュメント来歴: 手動派生ノート作成を記録
        newDoc = await recordRevision(newDoc, null, "human_derivation");
        const newFileId = await createFile(newDoc.title, newDoc);

        // 元ノートに noteLinks を追加して保存（Drive から最新を読み直して provenance を引き継ぐ）
        if (activeFileIdRef.current) {
          const latestDoc = await loadFile(activeFileIdRef.current);
          const noteLinks = latestDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId,
            type: "derived_from",
          });
          let updatedDoc: GraphiumDocument = { ...latestDoc, noteLinks, modifiedAt: now };
          // ドキュメント来歴: 派生元として記録
          updatedDoc = await recordRevision(updatedDoc, latestDoc.pages[0], "derive_source", { force: true });
          await saveFile(activeFileIdRef.current, updatedDoc);
          // キャッシュも更新（次回 handleOpenFile でキャッシュから読む際に最新を返すため）
          docCacheRef.current.set(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `↳ ${derivedTitle}.graphium.json`, modifiedTime: now, createdTime: now },
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

  // AI 派生ノートを作成（構築済みの GraphiumDocument を受け取って保存）
  const handleAiDeriveNote = useCallback(
    async (doc: GraphiumDocument) => {
      setDeriving(true);
      try {
        // ドキュメント来歴: AI 派生ノート作成を記録
        const model = doc.generatedBy?.model ?? doc.generatedBy?.agent;
        doc = await recordRevision(doc, null, "ai_derivation", { agentLabel: model });
        const newFileId = await createFile(doc.title, doc);
        const now = new Date().toISOString();

        // 元ノートに noteLinks を追加して保存（Drive から最新を読み直して provenance を引き継ぐ）
        if (activeFileIdRef.current && doc.derivedFromBlockId) {
          const latestDoc = await loadFile(activeFileIdRef.current);
          const noteLinks = latestDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId: doc.derivedFromBlockId,
            type: "derived_from",
          });
          let updatedDoc: GraphiumDocument = { ...latestDoc, noteLinks, modifiedAt: now };
          // ドキュメント来歴: 派生元として記録
          updatedDoc = await recordRevision(updatedDoc, latestDoc.pages[0], "derive_source", { force: true });
          await saveFile(activeFileIdRef.current, updatedDoc);
          docCacheRef.current.set(activeFileIdRef.current, updatedDoc);
          setActiveDoc(updatedDoc);
        }

        // ファイル一覧を更新
        setFiles((prev) => [
          { id: newFileId, name: `${doc.title}.graphium.json`, modifiedTime: now, createdTime: now },
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

  /** キャッシュ優先でドキュメントを取得、なければストレージから読み込む */
  const loadDoc = useCallback(
    async (noteId: string): Promise<GraphiumDocument | null> => {
      const cached = docCacheRef.current.get(noteId);
      if (cached) return cached;
      try {
        const doc = await loadFile(noteId);
        if (doc) docCacheRef.current.set(noteId, doc);
        return doc;
      } catch {
        return null;
      }
    },
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
  // Drive ファイル名・メディアインデックス・参照ノートのブロック props.name を一括更新
  const handleRenameMedia = useCallback(async (entry: MediaIndexEntry, newName: string) => {
    // URL ブックマークは Drive ファイルがないのでインデックスのみ更新
    if (entry.type !== "url") {
      await renameMediaFile(entry.fileId, newName);
    }
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated = renameMediaEntry(current, entry.fileId, newName);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));

    // 参照ノートのブロック props.name を一括更新
    const noteIds = new Set(entry.usedIn.map((u) => u.noteId));
    const activeId = activeFileIdRef.current;

    // 現在開いているノートはキャッシュから即座に更新（楽観的更新）
    if (activeId && noteIds.has(activeId)) {
      const cached = docCacheRef.current.get(activeId);
      if (cached) {
        let changed = false;
        for (const page of cached.pages) {
          changed = updateBlockNameByUrl(page.blocks, entry.url, newName) || changed;
        }
        if (changed) {
          setActiveDoc({ ...cached });
          setEditorKey((k) => k + 1);
          saveFile(activeId, cached).catch((err) => console.warn(`ブロック名保存失敗 (activeNote):`, err));
        }
      }
    }

    // 他のノートはバックグラウンドで更新
    for (const noteId of noteIds) {
      if (noteId === activeId) continue;
      try {
        const doc = await loadFile(noteId);
        let changed = false;
        for (const page of doc.pages) {
          changed = updateBlockNameByUrl(page.blocks, entry.url, newName) || changed;
        }
        if (changed) {
          await saveFile(noteId, doc);
          docCacheRef.current.set(noteId, doc);
        }
      } catch (err) {
        console.warn(`ブロック名更新失敗 (noteId=${noteId}):`, err);
      }
    }
  }, []);

  // メディア削除（ギャラリーから呼ぶ）
  const handleDeleteMedia = useCallback(async (entry: MediaIndexEntry) => {
    // URL ブックマークは Drive 上にファイルがないので削除 API を呼ばない
    if (entry.type !== "url") {
      await deleteMediaFile(entry.fileId);
    }
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated = removeMediaEntry(current, entry.fileId);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
  }, []);

  // URL ブックマーク追加（重複チェック付き）
  const handleAddUrlBookmark = useCallback((entry: MediaIndexEntry) => {
    const current = mediaIndexRef.current ?? createEmptyIndex();
    // URL の重複チェック（mediaIndexRef は常に最新）
    if (entry.type === "url" && current.media.some((m) => m.type === "url" && m.url === entry.url)) {
      return; // 既に登録済み
    }
    const updated = addMediaEntry(current, entry);
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
  }, []);

  // --- Wiki ドキュメント操作 ---

  // Wiki を開く
  const handleOpenWikiFile = useCallback(async (wikiId: string) => {
    try {
      setShowNoteList(false);
      setActiveAssetType(null);
      setActiveLabel(null);
      setActiveWikiKind(null);

      const cached = docCacheRef.current.get(`wiki:${wikiId}`);
      if (cached) {
        setActiveFileId(`wiki:${wikiId}`);
        setActiveDoc(cached);
        setEditorKey((k) => k + 1);
        return;
      }
      const doc = await loadWikiFile(wikiId);
      docCacheRef.current.set(`wiki:${wikiId}`, doc);
      setActiveFileId(`wiki:${wikiId}`);
      setActiveDoc(doc);
      setEditorKey((k) => k + 1);
    } catch (err) {
      console.error("Wiki の読み込みに失敗:", err);
    }
  }, [setActiveFileId]);

  // Wiki を保存
  const handleSaveWikiFile = useCallback(
    async (wikiId: string, doc: GraphiumDocument) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        await saveWikiFile(wikiId, doc);
        docCacheRef.current.set(`wiki:${wikiId}`, doc);
        setWikiFiles((prev) =>
          prev.map((f) =>
            f.id === wikiId
              ? { ...f, name: `${doc.title}.graphium.json`, modifiedTime: new Date().toISOString() }
              : f
          )
        );
        // インデックスを更新
        if (noteIndexRef.current) {
          const updated = updateIndexEntry(noteIndexRef.current, wikiId, doc);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
      } catch (err) {
        console.error("Wiki の保存に失敗:", err);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    []
  );

  // Wiki を削除
  const handleDeleteWikiFile = useCallback(
    async (wikiId: string) => {
      try {
        docCacheRef.current.delete(`wiki:${wikiId}`);
        await deleteWikiFileFromStorage(wikiId);
        // インデックスから除去
        if (noteIndexRef.current) {
          const updated = removeIndexEntry(noteIndexRef.current, wikiId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        if (activeFileId === `wiki:${wikiId}`) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
        setWikiFiles((prev) => prev.filter((f) => f.id !== wikiId));
        setWikiMetas((prev) => { const next = new Map(prev); next.delete(wikiId); return next; });
      } catch (err) {
        console.error("Wiki の削除に失敗:", err);
      }
    },
    [activeFileId, setActiveFileId]
  );

  // Wiki の新規作成（Ingest 結果の保存用）
  const handleCreateWikiFile = useCallback(
    async (doc: GraphiumDocument): Promise<string> => {
      const newId = await createWikiFile(doc.title, doc);
      console.log(`[wiki-debug] createWikiFile: id=${newId}, title=${doc.title}`);
      docCacheRef.current.set(`wiki:${newId}`, doc);
      // wikiMetas を即座に更新（サイドバーに反映）
      setWikiMetas((prev) => {
        const next = new Map(prev);
        const headings = (doc.pages[0]?.blocks ?? [])
          .filter((b: any) => b.type === "heading" && b.props?.level === 2)
          .map((b: any) => Array.isArray(b.content) ? b.content.map((c: any) => c.text ?? "").join("") : "")
          .filter(Boolean);
        next.set(newId, {
          title: doc.title,
          kind: doc.wikiMeta?.kind ?? "concept",
          headings,
        });
        return next;
      });
      const now = new Date().toISOString();
      const newFile: GraphiumFile = {
        id: newId,
        name: `${doc.title}.graphium.json`,
        modifiedTime: now,
        createdTime: now,
      };
      setWikiFiles((prev) => [newFile, ...prev]);
      // インデックスに追加
      if (noteIndexRef.current) {
        const updated = updateIndexEntry(noteIndexRef.current, newId, doc, newFile);
        noteIndexRef.current = updated;
        setNoteIndex(updated);
        saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
      }
      return newId;
    },
    []
  );

  // Skill を開く
  const handleOpenSkillFile = useCallback(
    async (skillId: string) => {
      try {
        const cached = docCacheRef.current.get(`skill:${skillId}`);
        const doc = cached ?? await loadSkillFile(skillId);
        if (!cached) docCacheRef.current.set(`skill:${skillId}`, doc);
        setActiveFileId(`skill:${skillId}`);
        setActiveDoc(doc);
        setEditorKey((k) => k + 1);
      } catch (err) {
        console.error("Skill の読み込みに失敗:", err);
      }
    },
    [setActiveFileId]
  );

  // Skill を保存
  const handleSaveSkillFile = useCallback(
    async (skillId: string, doc: GraphiumDocument) => {
      try {
        await saveSkillFile(skillId, doc);
        docCacheRef.current.set(`skill:${skillId}`, doc);
        setSkillMetas((prev) => {
          const next = new Map(prev);
          next.set(skillId, {
            title: doc.title,
            description: doc.skillMeta?.description ?? "",
            availableForIngest: doc.skillMeta?.availableForIngest ?? true,
          });
          return next;
        });
        setSkillFiles((prev) => prev.map((f) =>
          f.id === skillId ? { ...f, modifiedTime: new Date().toISOString() } : f
        ));
      } catch (err) {
        console.error("Skill の保存に失敗:", err);
      }
    },
    []
  );

  // Skill を削除
  const handleDeleteSkillFile = useCallback(
    async (skillId: string) => {
      try {
        docCacheRef.current.delete(`skill:${skillId}`);
        await deleteSkillFileFromStorage(skillId);
        if (activeFileId === `skill:${skillId}`) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
        setSkillFiles((prev) => prev.filter((f) => f.id !== skillId));
        setSkillMetas((prev) => { const next = new Map(prev); next.delete(skillId); return next; });
      } catch (err) {
        console.error("Skill の削除に失敗:", err);
      }
    },
    [activeFileId, setActiveFileId]
  );

  // Skill の新規作成
  const handleCreateSkillFile = useCallback(
    async (doc: GraphiumDocument): Promise<string> => {
      const newId = await createSkillFile(doc.title, doc);
      docCacheRef.current.set(`skill:${newId}`, doc);
      setSkillMetas((prev) => {
        const next = new Map(prev);
        next.set(newId, {
          title: doc.title,
          description: doc.skillMeta?.description ?? "",
          availableForIngest: doc.skillMeta?.availableForIngest ?? true,
        });
        return next;
      });
      const now = new Date().toISOString();
      const newFile: GraphiumFile = {
        id: newId,
        name: `${doc.title}.skill.graphium.json`,
        modifiedTime: now,
        createdTime: now,
      };
      setSkillFiles((prev) => [newFile, ...prev]);
      return newId;
    },
    []
  );

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
    activeLabel,
    setActiveLabel,
    setActiveAssetType,
    // アクション
    refreshFiles,
    refreshMediaIndex,
    handleOpenFile,
    handleNewNote,
    handleNewFromTemplate,
    handleSave,
    handleDeriveNote,
    handleAiDeriveNote,
    handleDelete,
    getCachedDoc,
    loadDoc,
    handleUploadMedia,
    handleDeleteMedia,
    handleRenameMedia,
    handleAddUrlBookmark,
    // Wiki
    wikiFiles,
    wikiMetas,
    activeWikiKind,
    setActiveWikiKind,
    handleOpenWikiFile,
    handleSaveWikiFile,
    handleDeleteWikiFile,
    handleCreateWikiFile,
    // Skill
    skillFiles,
    skillMetas,
    handleOpenSkillFile,
    handleSaveSkillFile,
    handleDeleteSkillFile,
    handleCreateSkillFile,
  };
}
