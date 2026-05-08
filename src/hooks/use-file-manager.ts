// ファイル管理 hook
// NoteApp のファイル一覧/キャッシュ/開く/新規/保存/削除/派生/グラフ/インデックスを集約

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphiumFile, GraphiumDocument, WikiKind, WikiMetaSummary } from "../lib/document-types";
import { getActiveProvider } from "../lib/storage/registry";
import { PROV_TEMPLATE } from "../lib/prov-template";
import { recordRevision } from "../features/document-provenance/tracker";
import type { EditActivityType } from "../features/document-provenance/types";

/** Wiki 保存・新規作成時のリビジョン記録オプション */
export type WikiSaveOptions = {
  /** AI 由来の操作で明示的にリビジョン記録したい場合に指定。
   *  エディタ経由のユーザー保存は呼び出し側で recordRevision 済みなので省略する。 */
  activityType?: EditActivityType;
  agentLabel?: string;
};
import {
  buildDerivedDocument,
  appendDerivedNoteLink,
} from "../features/derivation/clone-document";
import {
  buildNoteGraph,
  buildLineageTree,
  type LineageNode,
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
  softDeleteIndexEntry,
  restoreIndexEntry,
  archiveIndexEntry,
  restoreFromArchive,
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
  // 上流リネージツリー（レイヤー2 PROV）
  const [lineageTree, setLineageTree] = useState<LineageNode | null>(null);
  // Split View 用の派生元ノート（NoteApp レベルで管理し、ファイル切り替えでも保持）
  const [sourceDoc, setSourceDoc] = useState<GraphiumDocument | null>(null);
  // ノート一覧ビューの表示状態
  const [showNoteList, setShowNoteList] = useState(false);
  // 最近のノート履歴
  const [recentNotes, setRecentNotes] = useState<RecentNote[]>(() => getRecentNotes());
  // ノートインデックス（.graphium-index.json）
  // rawNoteIndex は ゴミ箱内のエントリも含む全件（ゴミ箱ビューはこちらを使う）
  // noteIndex は deletedAt 付きエントリを除外したビュー（メイン一覧・検索・picker・グラフが使う）
  const [rawNoteIndex, setRawNoteIndex] = useState<GraphiumIndex | null>(null);
  const noteIndexRef = useRef<GraphiumIndex | null>(null);
  // 既存呼び出しを破壊しないため setNoteIndex 名を維持（ref と raw state を同期するラッパ）
  const setNoteIndex = useCallback((next: GraphiumIndex | null) => {
    noteIndexRef.current = next;
    setRawNoteIndex(next);
  }, []);
  // メイン一覧用: deletedAt / archivedAt エントリを除外した index ビュー
  const noteIndex: GraphiumIndex | null = useMemo(() => {
    if (!rawNoteIndex) return null;
    return { ...rawNoteIndex, notes: rawNoteIndex.notes.filter((n) => !n.deletedAt && !n.archivedAt) };
  }, [rawNoteIndex]);
  // ゴミ箱用: deletedAt エントリのみ（アーカイブは含めない）
  const trashedNotes = useMemo(
    () => (rawNoteIndex ? rawNoteIndex.notes.filter((n) => n.deletedAt && !n.archivedAt) : []),
    [rawNoteIndex]
  );
  // アーカイブ用: archivedAt エントリのみ（ゴミ箱は含めない）
  const archivedNotes = useMemo(
    () => (rawNoteIndex ? rawNoteIndex.notes.filter((n) => n.archivedAt && !n.deletedAt) : []),
    [rawNoteIndex]
  );
  // アーカイブされた ID の Set（wikiFiles / files の一覧フィルタに使う）
  const archivedIdSet = useMemo(
    () => new Set(archivedNotes.map((n) => n.noteId)),
    [archivedNotes]
  );
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
  const [wikiMetas, setWikiMetas] = useState<Map<string, WikiMetaSummary>>(new Map());
  // Skill 関連の状態
  const [skillFiles, setSkillFiles] = useState<GraphiumFile[]>([]);
  const [skillMetas, setSkillMetas] = useState<Map<string, { title: string; description: string; availableForIngest: boolean; systemSkillId?: string; language?: "ja" | "en" }>>(new Map());

  // ファイル一覧を取得（ノートと Wiki と Skill を並列取得）
  // allSettled を使うことで、古いビルドで一部のコマンド（例: list_skill_files）が
  // 未実装でも他のリストは取得できるようにする
  const refreshFiles = useCallback(async () => {
    setFilesLoading(true);
    try {
      const [noteSettled, wikiSettled, skillSettled] = await Promise.allSettled([
        listFiles(),
        listWikiFiles(),
        listSkillFiles(),
      ]);
      const noteResult = noteSettled.status === "fulfilled" ? noteSettled.value : [];
      const wikiResult = wikiSettled.status === "fulfilled" ? wikiSettled.value : [];
      const skillResult = skillSettled.status === "fulfilled" ? skillSettled.value : [];
      if (noteSettled.status === "rejected") console.warn("listFiles failed:", noteSettled.reason);
      if (wikiSettled.status === "rejected") console.warn("listWikiFiles failed:", wikiSettled.reason);
      if (skillSettled.status === "rejected") console.warn("listSkillFiles failed:", skillSettled.reason);
      console.log(`[wiki-debug] refreshFiles: notes=${noteResult.length}, wikis=${wikiResult.length}`, wikiResult.map(f => f.id));
      setFiles(noteResult);
      setWikiFiles(wikiResult);
      setSkillFiles(skillResult);
      // Skill メタデータをバックグラウンドで読み込み
      // 同時にシステムスキル（default-voice-ja/en）が欠けていれば作成する
      Promise.allSettled(
        skillResult.map(async (f) => {
          const doc = await loadSkillFile(f.id);
          return { id: f.id, doc };
        })
      ).then(async (results) => {
        const metas = new Map<string, { title: string; description: string; availableForIngest: boolean; systemSkillId?: string; language?: "ja" | "en" }>();
        // systemSkillId ごとに、対応するファイル ID の配列（重複検出用）
        const systemSkillFiles = new Map<string, { id: string; modifiedAt: string }[]>();
        for (const r of results) {
          if (r.status === "fulfilled") {
            const { id, doc } = r.value;
            metas.set(id, {
              title: doc.title,
              description: doc.skillMeta?.description ?? "",
              availableForIngest: doc.skillMeta?.availableForIngest ?? true,
              systemSkillId: doc.skillMeta?.systemSkillId,
              language: doc.skillMeta?.language,
            });
            docCacheRef.current.set(`skill:${id}`, doc);
            if (doc.skillMeta?.systemSkillId) {
              const arr = systemSkillFiles.get(doc.skillMeta.systemSkillId) ?? [];
              arr.push({ id, modifiedAt: doc.modifiedAt });
              systemSkillFiles.set(doc.skillMeta.systemSkillId, arr);
            }
          }
        }

        // 同じ systemSkillId を持つファイルが 2 つ以上あれば、最も新しいもの 1 つだけ残す
        const provider = storage();
        const removedIds: string[] = [];
        for (const [systemId, files] of systemSkillFiles.entries()) {
          if (files.length <= 1) continue;
          // modifiedAt 降順でソート、先頭以外を削除
          files.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
          for (const dup of files.slice(1)) {
            try {
              if (provider.deleteSkillFile) {
                await provider.deleteSkillFile(dup.id);
              }
              metas.delete(dup.id);
              docCacheRef.current.delete(`skill:${dup.id}`);
              removedIds.push(dup.id);
              console.info(`[bootstrap] 重複したシステムスキル ${systemId} (file ${dup.id}) を削除しました`);
            } catch (err) {
              console.warn("重複システムスキルの削除に失敗:", err);
            }
          }
        }
        if (removedIds.length > 0) {
          setSkillFiles((prev) => prev.filter((f) => !removedIds.includes(f.id)));
        }

        const existingSystemIds = new Set<string>(systemSkillFiles.keys());

        // システムスキルが未作成なら同梱定義から生成する（ストレージプロバイダーが対応している場合のみ）
        try {
          const { SYSTEM_SKILLS } = await import("../features/skill/system-skills");
          const { buildSystemSkillDocument } = await import("../features/skill/skill-service");
          if (provider.saveSkillFile) {
            for (const def of SYSTEM_SKILLS) {
              if (existingSystemIds.has(def.id)) continue;
              const newId = crypto.randomUUID();
              const doc = buildSystemSkillDocument(def);
              await provider.saveSkillFile(newId, doc);
              metas.set(newId, {
                title: doc.title,
                description: doc.skillMeta?.description ?? "",
                availableForIngest: doc.skillMeta?.availableForIngest ?? true,
                systemSkillId: doc.skillMeta?.systemSkillId,
                language: doc.skillMeta?.language,
              });
              docCacheRef.current.set(`skill:${newId}`, doc);
              setSkillFiles((prev) => [...prev, { id: newId, name: doc.title, modifiedTime: doc.modifiedAt, createdTime: doc.createdAt }]);
            }
          }
        } catch (err) {
          console.warn("システムスキルのブートストラップに失敗:", err);
        }

        setSkillMetas(metas);
      });
      // Wiki メタデータをバックグラウンドで読み込み（サイドバーカウント・リスト表示用）
      if (wikiResult.length > 0) {
        Promise.allSettled(
          wikiResult.map(async (f) => {
            const doc = await loadWikiFile(f.id);
            return { id: f.id, doc };
          })
        ).then((results) => {
          const metas = new Map<string, WikiMetaSummary>();
          for (const r of results) {
            if (r.status === "fulfilled") {
              const { id, doc } = r.value;
              metas.set(id, {
                title: doc.title,
                kind: doc.wikiMeta?.kind ?? "concept",
                model: doc.wikiMeta?.generatedBy?.model,
                level: doc.wikiMeta?.level,
                status: doc.wikiMeta?.status,
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
    async (currentId: string | null, noteList: GraphiumFile[], wikiList: GraphiumFile[]) => {
      if (!currentId || (noteList.length === 0 && wikiList.length === 0)) {
        setNoteGraphData({ nodes: [], edges: [] });
        return;
      }
      // ノートだけ未取得のものをバックグラウンドで読み込み（wiki は別の loader が必要なのでここでは
      // 読み込まず、すでに開かれた wiki だけがキャッシュにある状態で動く）
      const missingNotes = noteList.filter((f) => !docCacheRef.current.has(f.id));
      if (missingNotes.length > 0) {
        const results = await Promise.allSettled(
          missingNotes.map(async (f) => {
            const doc = await loadFile(f.id);
            docCacheRef.current.set(f.id, doc);
          })
        );
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(`ノート読み込みスキップ: ${missingNotes[i].name}`);
          }
        });
      }
      // Wiki も同様にバックグラウンドでロード（リネージツリーで atom→concept→note を辿るため）
      const missingWikis = wikiList.filter((f) => !docCacheRef.current.has(`wiki:${f.id}`));
      if (missingWikis.length > 0) {
        const results = await Promise.allSettled(
          missingWikis.map(async (f) => {
            const doc = await loadWikiFile(f.id);
            docCacheRef.current.set(`wiki:${f.id}`, doc);
          })
        );
        results.forEach((r, i) => {
          if (r.status === "rejected") {
            console.warn(`Wiki 読み込みスキップ: ${missingWikis[i].name}`);
          }
        });
      }
      // ゴミ箱内のノートはグラフから除外
      const trashedIds = new Set(
        (noteIndexRef.current?.notes ?? []).filter((n) => n.deletedAt).map((n) => n.noteId)
      );
      const visibleNotes = noteList.filter((f) => !trashedIds.has(f.id));
      const visibleWikis = wikiList.filter((f) => !trashedIds.has(f.id));
      // buildNoteGraph 用に「素の ID → doc」のマップを作る。ノートと Wiki はキャッシュキーが
      // 異なる（"<id>" / "wiki:<id>"）ため、ここで揃える。
      const docs = new Map<string, GraphiumDocument>();
      for (const f of visibleNotes) {
        const doc = docCacheRef.current.get(f.id);
        if (doc) docs.set(f.id, doc);
      }
      for (const f of visibleWikis) {
        const doc = docCacheRef.current.get(`wiki:${f.id}`);
        if (doc) docs.set(f.id, doc);
      }
      const allFiles = [...visibleNotes, ...visibleWikis];
      const mIndex = mediaIndexRef.current;
      setNoteGraphData(buildNoteGraph(currentId, allFiles, docs, mIndex));
      setLineageTree(buildLineageTree(currentId, allFiles, docs, mIndex));
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
        // 再構築前に Wiki エントリの archivedAt / deletedAt を保存しておき、
        // buildIndexEntry の結果に再付与する（フラグが消えると archive 機能が壊れる）。
        //
        // snapshot ソースは noteIndexRef.current を優先する。`index` は ensureIndex の
        // 結果で prefetched (起動時スナップショット) ベースなので、セッション中に
        // archiveIndexEntry 等で更新された archivedAt を含まない。
        const flagSource = noteIndexRef.current ?? index;
        const wikiFlagSnapshot = new Map<string, { archivedAt?: string; deletedAt?: string }>();
        for (const n of flagSource.notes) {
          if (n.source === "ai" && (n.archivedAt || n.deletedAt)) {
            wikiFlagSnapshot.set(n.noteId, { archivedAt: n.archivedAt, deletedAt: n.deletedAt });
          }
        }

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
            const flags = wikiFlagSnapshot.get(file.id);
            if (flags?.archivedAt) entry.archivedAt = flags.archivedAt;
            if (flags?.deletedAt) entry.deletedAt = flags.deletedAt;
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

  // activeFileId や files / wikiFiles が変わったらグラフを再構築。
  // Wiki ページ（Concept / Synthesis）を開いているときも、その wiki の派生関係を
  // 表示できるよう wikiFiles も合わせて渡す。
  useEffect(() => {
    if (activeFileId) {
      // activeFileId は "wiki:<id>" / "skill:<id>" 形式の場合があるので素の ID に戻す
      const rawId = activeFileId.replace(/^(wiki|skill):/, "");
      rebuildGraph(rawId, files, wikiFiles);
    }
  }, [activeFileId, files, wikiFiles, rebuildGraph]);

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
        // ファイル一覧未ロード中は currentFileId が一覧に無いように見える。
        // ここで「新規作成」分岐に落ちると同じノートの重複が作られるので、
        // 一覧読み込み完了まで保存をスキップする。
        if (currentFileId && !fileExists && filesLoading) {
          console.warn(
            "[handleSave] files list not loaded yet; skipping save to avoid duplicate creation",
            { activeFileId: currentFileId },
          );
          return;
        }
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
    [setActiveFileId, files, filesLoading]
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

  // ノート全体を派生する（Phase 4）
  // 既存ノートの blocks / labels / provLinks / knowledgeLinks を新 ID で複製し、
  // derivedFromNoteId を張った別ファイルとして保存する。
  const handleDeriveWholeNote = useCallback(
    async (derivedTitle?: string) => {
      const sourceNoteId = activeFileIdRef.current;
      if (!sourceNoteId) return;
      setDeriving(true);
      try {
        // Drive 上の最新を読み直してからクローン（ローカルで編集中の未保存内容より
        // 永続化された最新を派生元にする方が PROV 的に正しい）
        const sourceDoc = await loadFile(sourceNoteId);
        const title = derivedTitle?.trim() || `↳ ${sourceDoc.title}`;
        const now = new Date().toISOString();

        let newDoc: GraphiumDocument = buildDerivedDocument({
          sourceDoc,
          sourceNoteId,
          derivedTitle: title,
          now,
        });
        newDoc = await recordRevision(newDoc, null, "human_derivation");
        const newFileId = await createFile(newDoc.title, newDoc);

        // 元ノートに derived_from の noteLinks を追加して保存
        let updatedSource: GraphiumDocument = {
          ...sourceDoc,
          noteLinks: appendDerivedNoteLink(sourceDoc.noteLinks, newFileId),
          modifiedAt: now,
        };
        updatedSource = await recordRevision(
          updatedSource,
          sourceDoc.pages[0],
          "derive_source",
          { force: true },
        );
        await saveFile(sourceNoteId, updatedSource);
        docCacheRef.current.set(sourceNoteId, updatedSource);
        setActiveDoc(updatedSource);

        setFiles((prev) => [
          { id: newFileId, name: `${newDoc.title}.graphium.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        if (noteIndexRef.current) {
          let updatedIndex = updateIndexEntry(noteIndexRef.current, newFileId, newDoc);
          updatedIndex = updateIndexEntry(updatedIndex, sourceNoteId, updatedSource);
          noteIndexRef.current = updatedIndex;
          setNoteIndex(updatedIndex);
          saveIndexFile(updatedIndex).catch((err) => console.warn("インデックス保存失敗:", err));
        }

        handleOpenFile(newFileId);
      } catch (err) {
        console.error("ノート全体の派生に失敗:", err);
      } finally {
        setDeriving(false);
      }
    },
    [handleOpenFile],
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

  // ゴミ箱に送る（ソフトデリート）
  // - インデックスに deletedAt をセットするだけ。ファイル本体・他ノートの参照は保持する
  // - 復元時に元の状態を取り戻せるよう、関連ノートのリンクには触らない
  // - Recent からは除去し、開いていれば閉じる
  const handleDelete = useCallback(
    async (fileId: string) => {
      try {
        // 最近のノートからは除く
        setRecentNotes(removeFromRecent(fileId));
        // インデックスに deletedAt をセット
        if (noteIndexRef.current) {
          const updated = softDeleteIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        // 開いていれば閉じる
        if (activeFileId === fileId) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("ゴミ箱への移動に失敗:", err);
      }
    },
    [activeFileId, setActiveFileId]
  );

  // ゴミ箱から復元（deletedAt を消す）
  const handleRestore = useCallback(
    async (fileId: string) => {
      try {
        if (noteIndexRef.current) {
          const updated = restoreIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
      } catch (err) {
        console.error("ゴミ箱からの復元に失敗:", err);
      }
    },
    []
  );

  // 完全削除（OS のゴミ箱へ送る or プロバイダ固有の最終削除）
  // - 関連ノートのリンクをクリーンアップしてから storage().deleteFile を呼ぶ
  // - desktop では Tauri 側で trash クレートが OS ゴミ箱に送る
  // - web (IndexedDB) / server-fs は即時消去、Google Drive は Drive のゴミ箱
  const handlePermanentDelete = useCallback(
    async (fileId: string) => {
      try {
        // 削除対象のドキュメントを取得（参照クリーンアップ用）
        let targetDoc = docCacheRef.current.get(fileId);
        if (!targetDoc) {
          // ゴミ箱から完全削除する場合、キャッシュにないことがある
          try {
            targetDoc = await loadFile(fileId);
          } catch {
            // 既にファイルが無くても続行
          }
        }

        if (targetDoc) {
          // 1. 派生元ノートの noteLinks から参照を除去
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
        setRecentNotes(removeFromRecent(fileId));
        // インデックスから除去（完全削除なのでエントリごと消す）
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
        console.error("完全削除に失敗:", err);
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
  /**
   * メディアの sharedRef を更新する（Phase 2b-media）。
   * shared への書き込み自体は呼び出し側（モーダル）で済ませており、ここでは
   * media index に sharedRef を埋め込んで永続化するだけ。
   */
  const handleUpdateMediaSharedRef = useCallback(async (
    entry: MediaIndexEntry,
    sharedRef: import("../features/asset-browser/media-index").MediaSharedRef,
  ) => {
    const current = mediaIndexRef.current ?? createEmptyIndex();
    const updated: MediaIndex = {
      ...current,
      updatedAt: new Date().toISOString(),
      media: current.media.map((m) =>
        m.fileId === entry.fileId ? { ...m, sharedRef } : m,
      ),
    };
    mediaIndexRef.current = updated;
    setMediaIndex(updated);
    saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
  }, []);

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
    async (wikiId: string, doc: GraphiumDocument, options?: WikiSaveOptions) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        // AI 由来の更新（merge / cross-update など）はここでリビジョンを刻む。
        // エディタ経由のユーザー保存は buildDocument で記録済みなので options 未指定。
        if (options?.activityType) {
          const cached = docCacheRef.current.get(`wiki:${wikiId}`);
          const prevPage = cached?.pages?.[0] ?? null;
          doc = await recordRevision(doc, prevPage, options.activityType, {
            agentLabel: options.agentLabel,
            force: true,
          });
        }
        await saveWikiFile(wikiId, doc);
        docCacheRef.current.set(`wiki:${wikiId}`, doc);
        setWikiFiles((prev) =>
          prev.map((f) =>
            f.id === wikiId
              ? { ...f, name: `${doc.title}.graphium.json`, modifiedTime: new Date().toISOString() }
              : f
          )
        );
        // wikiMetas を即座に更新（サイドバー・リストの title 表示は wikiMetas を参照しているため）
        setWikiMetas((prev) => {
          const next = new Map(prev);
          const existing = next.get(wikiId);
          next.set(wikiId, {
            title: doc.title,
            kind: doc.wikiMeta?.kind ?? existing?.kind ?? "concept",
            model: doc.wikiMeta?.generatedBy?.model ?? existing?.model,
            level: doc.wikiMeta?.level ?? existing?.level,
            status: doc.wikiMeta?.status ?? existing?.status,
          });
          return next;
        });
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

  // Wiki をアーカイブする（ファイル本体は残し、archivedAt をセットするだけ）
  // 主に Concept merge で吸収された Wiki の参照保護のために使う。
  // 一覧・検索からは消えるが、引用 / regenerate / グラフ探索からは引き続き解決できる。
  //
  // 注: wikiFiles state は触らない。触ると index 再構築 effect が発火し、
  // archived エントリを「ai 系の旧エントリ」として除去してしまう。一覧表示の除外は
  // フック return 側の `wikiFiles: wikiFiles.filter(!archivedIdSet)` が担当する。
  const handleArchiveWikiFile = useCallback(
    async (wikiId: string) => {
      try {
        const indexId = wikiId; // wiki もインデックス上は noteId として扱われる
        if (noteIndexRef.current) {
          const updated = archiveIndexEntry(noteIndexRef.current, indexId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        if (activeFileId === `wiki:${wikiId}`) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("Wiki のアーカイブに失敗:", err);
      }
    },
    [activeFileId, setActiveFileId]
  );

  // アーカイブから復元（archivedAt を消す）
  const handleRestoreFromArchive = useCallback(
    async (fileId: string) => {
      try {
        if (noteIndexRef.current) {
          const updated = restoreFromArchive(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
        }
        // wiki の場合は wikiFiles state にも戻す必要がある — 次回 listWikiFiles で同期される
        await refreshFiles();
      } catch (err) {
        console.error("アーカイブからの復元に失敗:", err);
      }
    },
    []
  );

  // アーカイブからゴミ箱に送る（archivedAt → deletedAt 付け替え）
  // ユーザーが「アーカイブ済みだがやはり捨てたい」と判断したときの導線。
  // 完全削除はゴミ箱経由のみとし、archive から直接消すパスは作らない。
  const handleSendArchiveToTrash = useCallback(
    async (fileId: string) => {
      try {
        if (noteIndexRef.current) {
          const restored = restoreFromArchive(noteIndexRef.current, fileId);
          const trashed = softDeleteIndexEntry(restored, fileId);
          noteIndexRef.current = trashed;
          setNoteIndex(trashed);
          saveIndexFile(trashed).catch((err) => console.warn("インデックス保存失敗:", err));
        }
      } catch (err) {
        console.error("アーカイブからゴミ箱への移動に失敗:", err);
      }
    },
    []
  );

  // 通常ノートの新規作成（構築済み GraphiumDocument を受け取って保存する汎用入り口）
  // URL → PROV ノート生成など、既存ノートに紐づかない新規作成で使う。
  // 派生リンクが必要な場合は handleAiDeriveNote を使うこと。
  const handleCreateNoteFromDocument = useCallback(
    async (doc: GraphiumDocument): Promise<string> => {
      const agentLabel = doc.generatedBy?.model ?? doc.generatedBy?.agent;
      doc = await recordRevision(doc, null, "ai_derivation", { agentLabel });
      const newFileId = await createFile(doc.title, doc);
      const now = new Date().toISOString();
      docCacheRef.current.set(newFileId, doc);

      setFiles((prev) => [
        { id: newFileId, name: `${doc.title}.graphium.json`, modifiedTime: now, createdTime: now },
        ...prev,
      ]);

      if (noteIndexRef.current) {
        const updated = updateIndexEntry(noteIndexRef.current, newFileId, doc);
        noteIndexRef.current = updated;
        setNoteIndex(updated);
        saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
      }

      return newFileId;
    },
    [],
  );

  // 外部ファイル（Word / 将来 PowerPoint 等）からの取り込みでノートを新規作成する。
  // human_derivation として記録 — 元ファイルからの抽出はユーザー由来の派生
  const handleCreateNoteFromImport = useCallback(
    async (doc: GraphiumDocument): Promise<string> => {
      doc = await recordRevision(doc, null, "human_derivation");
      const newFileId = await createFile(doc.title, doc);
      const now = new Date().toISOString();
      docCacheRef.current.set(newFileId, doc);

      setFiles((prev) => [
        { id: newFileId, name: `${doc.title}.graphium.json`, modifiedTime: now, createdTime: now },
        ...prev,
      ]);

      if (noteIndexRef.current) {
        const updated = updateIndexEntry(noteIndexRef.current, newFileId, doc);
        noteIndexRef.current = updated;
        setNoteIndex(updated);
        saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
      }

      return newFileId;
    },
    [],
  );

  // 取り込み 2 パス目用: 既存ノートに対して link 解決済みの doc を上書き保存する。
  // recordRevision を呼ばないため、handleCreateNoteFromImport 直後の追加保存でリビジョンが
  // 二重に積まれない。インデックスとキャッシュも追従更新する。
  const handleSaveImportedDoc = useCallback(
    async (noteId: string, doc: GraphiumDocument): Promise<void> => {
      docCacheRef.current.set(noteId, doc);
      await saveFile(noteId, doc);
      if (noteIndexRef.current) {
        const updated = updateIndexEntry(noteIndexRef.current, noteId, doc);
        noteIndexRef.current = updated;
        setNoteIndex(updated);
        saveIndexFile(updated).catch((err) => console.warn("インデックス保存失敗:", err));
      }
    },
    [],
  );

  // Wiki の新規作成（Ingest 結果の保存用）
  // 呼び出し元はすべて AI 生成フローのため、デフォルトで ai_generation を記録する。
  const handleCreateWikiFile = useCallback(
    async (doc: GraphiumDocument, options?: WikiSaveOptions): Promise<string> => {
      const activityType: EditActivityType = options?.activityType ?? "ai_generation";
      const agentLabel =
        options?.agentLabel
          ?? doc.wikiMeta?.generatedBy?.model
          ?? doc.generatedBy?.model
          ?? doc.generatedBy?.agent
          ?? "ai";
      doc = await recordRevision(doc, null, activityType, { agentLabel, force: true });
      const newId = await createWikiFile(doc.title, doc);
      console.log(`[wiki-debug] createWikiFile: id=${newId}, title=${doc.title}`);
      docCacheRef.current.set(`wiki:${newId}`, doc);
      // wikiMetas を即座に更新（サイドバーに反映）
      setWikiMetas((prev) => {
        const next = new Map(prev);
        next.set(newId, {
          title: doc.title,
          kind: doc.wikiMeta?.kind ?? "concept",
          model: doc.wikiMeta?.generatedBy?.model,
          level: doc.wikiMeta?.level,
          status: doc.wikiMeta?.status,
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
            systemSkillId: doc.skillMeta?.systemSkillId,
            language: doc.skillMeta?.language,
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

  // システム同梱スキルをデフォルト内容に戻す
  const handleResetSystemSkill = useCallback(
    async (skillId: string) => {
      const meta = skillMetas.get(skillId);
      if (!meta?.systemSkillId) {
        console.warn("システムスキルではないのでリセットできません:", skillId);
        return;
      }
      try {
        const { getSystemSkillById } = await import("../features/skill/system-skills");
        const { buildSystemSkillDocument } = await import("../features/skill/skill-service");
        const def = getSystemSkillById(meta.systemSkillId as any);
        if (!def) return;
        const doc = buildSystemSkillDocument(def);
        await saveSkillFile(skillId, doc);
        docCacheRef.current.set(`skill:${skillId}`, doc);
        setSkillMetas((prev) => {
          const next = new Map(prev);
          next.set(skillId, {
            title: doc.title,
            description: doc.skillMeta?.description ?? "",
            availableForIngest: doc.skillMeta?.availableForIngest ?? true,
            systemSkillId: doc.skillMeta?.systemSkillId,
            language: doc.skillMeta?.language,
          });
          return next;
        });
        if (activeFileId === `skill:${skillId}`) {
          setActiveDoc(doc);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("システムスキルのリセットに失敗:", err);
      }
    },
    [skillMetas, activeFileId, setActiveDoc, setEditorKey]
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
    lineageTree,
    sourceDoc,
    setSourceDoc,
    showNoteList,
    setShowNoteList,
    recentNotes,
    noteIndex,
    rawNoteIndex,
    trashedNotes,
    archivedNotes,
    archivedIdSet,
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
    handleDeriveWholeNote,
    handleAiDeriveNote,
    handleDelete,
    handleRestore,
    handlePermanentDelete,
    handleArchiveWikiFile,
    handleRestoreFromArchive,
    handleSendArchiveToTrash,
    getCachedDoc,
    loadDoc,
    handleUploadMedia,
    handleDeleteMedia,
    handleRenameMedia,
    handleUpdateMediaSharedRef,
    handleAddUrlBookmark,
    handleCreateNoteFromDocument,
    handleCreateNoteFromImport,
    handleSaveImportedDoc,
    // Wiki — アーカイブ・ゴミ箱のエントリは UI 表示・グラフから除外する
    // （ファイル本体は残るので、リンクや regenerate からは引き続き透過解決できる）
    wikiFiles: wikiFiles.filter((f) => !archivedIdSet.has(f.id)),
    allWikiFiles: wikiFiles,
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
    handleResetSystemSkill,
    handleCreateSkillFile,
  };
}
