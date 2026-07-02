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
  collectSourceAssetFileIdsFromDoc,
  updateBlockNameByUrl,
  mimeToMediaType,
  readMediaIndex,
  ensureMediaIndex,
  MEDIA_INDEX_CHANGED_EVENT,
  type MediaIndex,
  type MediaIndexEntry,
  type MediaType,
} from "../features/asset-browser";

import { isIncomingDocNewer } from "./doc-recency";
import { normalizeNoteContexts } from "../features/note-context/context-tags";

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
  // インデックス保存をシリアライズするためのチェイン。
  // bulk delete のように短時間に複数回 saveIndexFile を呼ぶと、
  // server-fs プロバイダ等で並行 HTTP PUT のレースが起きて
  // 「ゴミ箱に送ったはずのノートが復活する」事故が発生する。
  // すべての保存をこの Promise チェインで直列化することで防ぐ。
  const saveIndexChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const queueSaveIndex = useCallback((index: GraphiumIndex): Promise<unknown> => {
    const next = saveIndexChainRef.current
      .catch(() => undefined)
      .then(() => saveIndexFile(index))
      .catch((err) => console.warn("インデックス保存失敗:", err));
    saveIndexChainRef.current = next;
    return next;
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
  // ゴミ箱内 ID の Set（wikiFiles の一覧フィルタに使う。
  // ノートは noteIndex 経由でフィルタされるため別途不要）
  const trashedIdSet = useMemo(
    () => new Set(trashedNotes.map((n) => n.noteId)),
    [trashedNotes]
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
      console.log(`[wiki-debug] refreshFiles: notes=${noteResult.length}, wikis=${wikiResult.length}`, wikiResult.map(f => f.id));
      // 一覧取得が transient に失敗したとき（sidecar の一時エラー等）に既存の
      // files を空で上書きすると、直後の auto-save が handleSave の新規作成分岐に
      // 落ちて開いているノートが新 id で複製される。失敗時は前回の一覧を保持する。
      if (noteSettled.status === "fulfilled") {
        setFiles(noteResult);
      } else {
        console.warn("listFiles failed; keeping previous note list to avoid duplicate-on-save:", noteSettled.reason);
      }
      if (wikiSettled.status === "fulfilled") {
        setWikiFiles(wikiResult);
      } else {
        console.warn("listWikiFiles failed; keeping previous wiki list:", wikiSettled.reason);
      }
      if (skillSettled.status === "fulfilled") {
        setSkillFiles(skillResult);
      } else {
        console.warn("listSkillFiles failed; keeping previous skill list:", skillSettled.reason);
      }
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
              const validity = doc.wikiMeta?.grounding?.validity;
              metas.set(id, {
                title: doc.title,
                kind: doc.wikiMeta?.kind ?? "claim",
                model: doc.wikiMeta?.generatedBy?.model,
                level: doc.wikiMeta?.level,
                status: doc.wikiMeta?.status,
                claimRole: doc.wikiMeta?.claimRole,
                atomType: doc.wikiMeta?.atomType,
                synthesisMode: doc.wikiMeta?.synthesisMode,
                hypothesisStatus: doc.wikiMeta?.hypothesisStatus,
                theme: doc.wikiMeta?.kind === "synthesis" ? doc.wikiMeta?.theme : undefined,
                groundingValidity: validity
                  ? {
                      verdict: validity.verdict,
                      checkedAt: validity.checkedAt,
                      entryId: validity.entryId,
                      dismissed: validity.dismissed,
                    }
                  : undefined,
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

  // disk 経由で media-index が外部から書き換えられた時の同期
  // 例: URL Reader Mode (PR3-d) が persistUrlMetaPatch で urlMeta.excerpt を
  // 書き戻すと、in-memory state と disk が乖離するので再読込で揃える。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChanged = () => {
      void refreshMediaIndex();
    };
    window.addEventListener(MEDIA_INDEX_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(MEDIA_INDEX_CHANGED_EVENT, onChanged);
  }, [refreshMediaIndex]);

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
      // サイドピーク等から保存済みドキュメントが渡された場合、キャッシュを即時更新。
      // ただし渡された doc が現在のキャッシュより古いと、本文エディタが再マウント時に
      // その古いスナップショットへ巻き戻り、書いた文章が消える。より新しいときだけ採用する。
      let broughtNewerDoc = false;
      if (cachedDoc && isIncomingDocNewer(cachedDoc, docCacheRef.current.get(fileId))) {
        docCacheRef.current.set(fileId, cachedDoc);
        broughtNewerDoc = true;
      }
      // 既に本文で開いているノートを開き直す場合、エディタには未保存のライブ編集
      // （直近 3 秒の自動保存待ちを含む）が残っている。より新しい内容を持ち込んだので
      // ない限り、再マウントせず現状を保持する。再マウントすると activeDoc 起点へ
      // 巻き戻り、書いたばかりの文章が消える。表示中なら一覧等を閉じた時点で本文へ戻る。
      if (fileId === activeFileIdRef.current && !broughtNewerDoc) {
        return;
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

      // 通常ノートの archivedAt / deletedAt を直前の in-memory index から復元する。
      // prefetch（起動時スナップショット）はセッション中の archive/restore を反映しない
      // ため、ensureIndex が保存後の stale 判定でフラグを落とすと、アーカイブ/ゴミ箱の
      // ノートが一覧へ復活してしまう。noteIndexRef.current が最新のユーザー意思を保持して
      // いるので、それを真実として再付与する（Wiki は上の wikiFlagSnapshot で復元済み）。
      const liveIndex = noteIndexRef.current;
      if (liveIndex) {
        const flagMap = new Map<string, { archivedAt?: string; deletedAt?: string }>();
        for (const n of liveIndex.notes) {
          if (n.source !== "ai" && (n.archivedAt || n.deletedAt)) {
            flagMap.set(n.noteId, { archivedAt: n.archivedAt, deletedAt: n.deletedAt });
          }
        }
        let restored = false;
        for (const n of index.notes) {
          if (n.source === "ai") continue;
          const f = flagMap.get(n.noteId);
          if (!f) continue;
          if (f.archivedAt && !n.archivedAt) { n.archivedAt = f.archivedAt; restored = true; }
          if (f.deletedAt && !n.deletedAt) { n.deletedAt = f.deletedAt; restored = true; }
        }
        // フラグを取り戻したらディスクにも反映（ensureIndex がフラグ落ち版を保存済みのため）
        if (restored) queueSaveIndex(index);
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
      // Wiki ノートは PDF を document-level (`wikiMeta.derivedFromNotes`) に持つため、
      // PDF アセットの usedIn を埋めるには Wiki も走査対象に含める必要がある。
      const idx = await ensureMediaIndex(
        files,
        docCacheRef.current,
        loadFile,
        wikiFiles,
        storage().loadWikiFile ? loadWikiFile : undefined,
      );
      if (!cancelled) {
        mediaIndexRef.current = idx;
        setMediaIndex(idx);
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated, noteIndex, files, wikiFiles]);

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
    // ギャラリービュー・Wiki リストを閉じる（残っているとレンダリング条件で前のビューが優先される）
    setActiveAssetType(null);
    setActiveLabel(null);
    setShowNoteList(false);
    setActiveWikiKind(null);
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
        // 孤児リンクをクリーンアップ（存在しないノートへの参照を除去）。
        // ただし一覧（files）が未ロード／transient 失敗で空のときに実行すると、
        // 生きているリンクまで「孤児」とみなして全消去してしまう。一覧が信頼できる
        // とき（ロード完了かつ非空）だけ掃除する。
        if (!filesLoading && files.length > 0) {
          const fileIds = new Set(files.map((f) => f.id));
          if (doc.noteLinks) {
            doc = { ...doc, noteLinks: doc.noteLinks.filter((l) => fileIds.has(l.targetNoteId)) };
            if (doc.noteLinks!.length === 0) doc = { ...doc, noteLinks: undefined };
          }
          if (doc.derivedFromNoteId && !fileIds.has(doc.derivedFromNoteId)) {
            doc = { ...doc, derivedFromNoteId: undefined, derivedFromBlockId: undefined };
          }
        }

        const currentFileId = activeFileIdRef.current;
        if (currentFileId) {
          // 既存ノートは常に同じ id へ上書き保存する。
          // ここで「新規作成」分岐に落ちると、同一ノートが新 id で複製され、
          // 既存の被参照リンク（他ノート→旧 id）が取り残されてしまう。
          // soft-delete / 完全削除はアクティブノートの activeFileId を null にするため、
          // currentFileId が立っている = そのノートは開いていてゴミ箱にない、が保証される。
          // よって一覧（files）が transient なロード失敗で stale/空でも、複製ではなく上書きが正しい。
          await saveFile(currentFileId, doc);
          // キャッシュも更新
          docCacheRef.current.set(currentFileId, doc);
          // activeDoc も最新化しておく。一覧やギャラリー等から本文へ戻ってエディタが
          // 再マウントされる際の復元元（NoteEditor の initialDoc）が、開いた時点の古い
          // 内容のままだと保存済みの編集まで巻き戻るため、保存のたびに追従させる。
          // NoteEditor 側の初期化は initializedRef で一度きりにガードされており、
          // initialDoc が変わってもマウント済みエディタの内容は再設定されない（チラつかない）。
          if (currentFileId === activeFileIdRef.current) {
            setActiveDoc(doc);
          }
          // ローカルのファイル一覧を upsert（stale で欠けていても復元する）
          setFiles((prev) => {
            const name = `${doc.title}.graphium.json`;
            const modifiedTime = new Date().toISOString();
            if (prev.some((f) => f.id === currentFileId)) {
              return prev.map((f) =>
                f.id === currentFileId ? { ...f, name, modifiedTime } : f
              );
            }
            return [
              { id: currentFileId, name, modifiedTime, createdTime: doc.createdAt ?? modifiedTime },
              ...prev,
            ];
          });
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
            queueSaveIndex(updated);
          }
        }

        // メディアインデックスの usedIn を同期
        if (mediaIndexRef.current) {
          const savedFileId = currentFileId ?? activeFileIdRef.current;
          if (savedFileId && doc.pages[0]) {
            const mediaMap = extractMediaFromBlocks(doc.pages[0].blocks || []);
            // PROV ノートはトップレベル `sourcePdfFileId` で PDF を参照するので
            // document-level の PDF 参照も渡して usedIn に反映する。
            const docPdfRefs = collectSourceAssetFileIdsFromDoc(doc);
            const updated = syncUsedIn(mediaIndexRef.current, savedFileId, doc.title, mediaMap, docPdfRefs);
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
          queueSaveIndex(updated);
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

  // `@` メニューの「新規ノートを作成」用。空ノートを作って ID を返すだけで、
  // ナビゲーションはしない（呼び出し側が本文に @リンクを挿入し、開いているノートに
  // 留まる）。クリック解決はタイトル逆引きのため、作成と同時に files / index へ
  // 載せて、直後のクリックでサイドピークが開けるようにする。
  const handleCreateLinkedNote = useCallback(
    async (title: string, sourceNoteId?: string): Promise<string | null> => {
      const cleanTitle = title.trim();
      if (!cleanTitle) return null;
      try {
        const now = new Date().toISOString();
        // 派生元: 明示指定（サイドピーク = 表示中ノート）があればそれ、無ければ
        // アクティブノート。Wiki / Skill は通常ノートの派生元として扱わない。
        const rawSource = sourceNoteId ?? activeFileIdRef.current ?? undefined;
        const derivedFromNoteId =
          rawSource && !rawSource.startsWith("wiki:") && !rawSource.startsWith("skill:")
            ? rawSource
            : undefined;
        let newDoc: GraphiumDocument = {
          version: 2,
          title: cleanTitle,
          pages: [{ id: "main", title: cleanTitle, blocks: [], labels: {}, provLinks: [], knowledgeLinks: [] }],
          // 派生元を記録（handleDeriveNote と同じ来歴の張り方）。
          // 元ノート側の noteLinks(derived_from) は呼び出し側の挿入フローが追加する。
          derivedFromNoteId,
          createdAt: now,
          modifiedAt: now,
        };
        newDoc = await recordRevision(newDoc, null, "human_derivation");
        const newFileId = await createFile(newDoc.title, newDoc);
        docCacheRef.current.set(newFileId, newDoc);

        // ファイル一覧に追加（resolveMentionNoteId のフォールバック逆引き用）
        setFiles((prev) => [
          { id: newFileId, name: `${cleanTitle}.graphium.json`, modifiedTime: now, createdTime: now },
          ...prev,
        ]);

        // インデックスに追加（resolveMentionNoteId のタイトル逆引きの主経路）
        if (noteIndexRef.current) {
          const updated = updateIndexEntry(noteIndexRef.current, newFileId, newDoc);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }

        return newFileId;
      } catch (err) {
        console.error("リンクノートの作成に失敗:", err);
        return null;
      }
    },
    [],
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
  // 戻り値は新ファイル ID。呼び出し元はこれを使って SidePeek 等で開く。
  const handleAiDeriveNote = useCallback(
    async (doc: GraphiumDocument): Promise<string> => {
      setDeriving(true);
      try {
        // ドキュメント来歴: AI 派生ノート作成を記録
        const model = doc.generatedBy?.model ?? doc.generatedBy?.agent;
        doc = await recordRevision(doc, null, "ai_derivation", { agentLabel: model });
        const newFileId = await createFile(doc.title, doc);
        const now = new Date().toISOString();

        // 元ノートに noteLinks を追加して保存（Drive から最新を読み直して provenance を引き継ぐ）
        // Wiki / Skill ノートは別ストレージで管理されており、通常ノート用の loadFile は使えない。
        // back-link を張らずに派生だけ進める（Wiki は LLM 生成なので来歴更新の対象外）。
        const activeId = activeFileIdRef.current;
        const isAuxiliaryNote = activeId?.startsWith("wiki:") || activeId?.startsWith("skill:");
        if (activeId && doc.derivedFromBlockId && !isAuxiliaryNote) {
          const latestDoc = await loadFile(activeId);
          const noteLinks = latestDoc.noteLinks ?? [];
          noteLinks.push({
            targetNoteId: newFileId,
            sourceBlockId: doc.derivedFromBlockId,
            type: "derived_from",
          });
          let updatedDoc: GraphiumDocument = { ...latestDoc, noteLinks, modifiedAt: now };
          // ドキュメント来歴: 派生元として記録
          updatedDoc = await recordRevision(updatedDoc, latestDoc.pages[0], "derive_source", { force: true });
          await saveFile(activeId, updatedDoc);
          docCacheRef.current.set(activeId, updatedDoc);
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
          queueSaveIndex(updated);
        }

        // 派生先ノートの ID を返す（呼び出し元で SidePeek 等を開く）
        return newFileId;
      } catch (err) {
        console.error("AI 派生ノートの作成に失敗:", err);
        throw err; // モーダル側でエラー表示
      } finally {
        setDeriving(false);
      }
    },
    [activeDoc, setActiveFileId],
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
          queueSaveIndex(updated);
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

  // 通常ノートをアーカイブする（ファイル本体は残し、archivedAt をセットするだけ）。
  // 削除（ゴミ箱）と違い ID は生き続けるため、派生リンク (derivedFromNotes) / 引用 /
  // regenerate / グラフ探索は引き続き解決できる。「新しい版を作って旧版を一覧から
  // 退避したい」ユーザー導線。アーカイブ済みは Trash & Archive 画面で復元できる。
  const handleArchiveNote = useCallback(
    async (fileId: string) => {
      try {
        // 最近のノートからは除く
        setRecentNotes(removeFromRecent(fileId));
        if (noteIndexRef.current) {
          const updated = archiveIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }
        // 開いていれば閉じる
        if (activeFileId === fileId) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("ノートのアーカイブに失敗:", err);
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
          queueSaveIndex(updated);
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
        // インデックスから wiki か note か判定する
        const entry = noteIndexRef.current?.notes.find((n) => n.noteId === fileId);
        const isWiki = entry?.source === "ai";
        const cacheKey = isWiki ? `wiki:${fileId}` : fileId;

        // 削除対象のドキュメントを取得（参照クリーンアップ用）
        let targetDoc = docCacheRef.current.get(cacheKey);
        if (!targetDoc) {
          // ゴミ箱から完全削除する場合、キャッシュにないことがある
          try {
            targetDoc = isWiki ? await loadWikiFile(fileId) : await loadFile(fileId);
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
        docCacheRef.current.delete(cacheKey);

        if (isWiki) {
          await deleteWikiFileFromStorage(fileId);
        } else {
          await deleteFile(fileId);
        }
        setRecentNotes(removeFromRecent(fileId));
        // インデックスから除去（完全削除なのでエントリごと消す）
        if (noteIndexRef.current) {
          const updated = removeIndexEntry(noteIndexRef.current, fileId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }
        // メディアインデックスから usedIn を除去
        if (mediaIndexRef.current) {
          const updated = removeNoteFromUsedIn(mediaIndexRef.current, fileId);
          mediaIndexRef.current = updated;
          setMediaIndex(updated);
          saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
        }
        const activeKey = isWiki ? `wiki:${fileId}` : fileId;
        if (activeFileId === activeKey) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
        // wiki の場合は wikiFiles state からも除去（次の refreshFiles で確定）
        if (isWiki) {
          setWikiFiles((prev) => prev.filter((f) => f.id !== fileId));
          setWikiMetas((prev) => { const next = new Map(prev); next.delete(fileId); return next; });
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

  // ノートの「文脈ラベル」（noteContexts）を更新して保存する。
  // 一覧・ヘッダのどちらからでも呼べるよう、activeFileId 依存でなく noteId を明示的に取る。
  // 対象が開いていないノートでも「同じ id へ上書き」保存する（save-path 不変条件を厳守。
  // createFile 分岐には決して落とさない = 新 id 複製を防ぐ）。index も差分更新して一覧に即反映する。
  const updateNoteContexts = useCallback(
    async (noteId: string, contexts: string[]): Promise<void> => {
      const doc = await loadDoc(noteId);
      if (!doc) {
        console.warn("文脈更新: ノートが読み込めませんでした:", noteId);
        return;
      }
      const normalized = normalizeNoteContexts(contexts);
      const nextDoc: GraphiumDocument = {
        ...doc,
        noteContexts: normalized,
        modifiedAt: new Date().toISOString(),
      };
      try {
        await saveFile(noteId, nextDoc);
        docCacheRef.current.set(noteId, nextDoc);
        // 開いているノートなら activeDoc も追従（エディタ復元元がずれないように）
        if (noteId === activeFileIdRef.current) {
          setActiveDoc(nextDoc);
        }
        // インデックスを差分更新して一覧に即反映
        if (noteIndexRef.current) {
          const updated = updateIndexEntry(noteIndexRef.current, noteId, nextDoc);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }
      } catch (err) {
        console.error("文脈の保存に失敗:", err);
        alert("文脈の保存に失敗しました。再度お試しください。");
      }
    },
    [loadDoc, setNoteIndex, queueSaveIndex]
  );

  // ノートファイルへの保存はコンポーネント側（SidePeek の doSave 等）で済ませた前提で、
  // その「保存済み doc」からインデックスエントリを丸ごと再構築し、doc キャッシュも最新化する。
  // saveFile は呼ばない（二重保存にならない）。
  //
  // 手動で noteContexts だけを差し替える方式ではなく updateIndexEntry（buildIndexEntry 経由）で
  // エントリ全体を作り直すのは、(a) noteContexts を含む全フィールドが正となる doc から確実に
  // 反映され、(b) 一覧復帰時に ensureIndex が走ってノートファイルから再構築しても内容が一致し、
  // 手動パッチと再構築が競合して「ノートには付いているが index には無い」不整合になるのを防ぐため。
  // 呼び出し側はノート保存の完了を await してからこれを呼ぶこと（保存前の古いファイルを
  // ensureIndex が読む競合を避ける）。
  const reindexNoteFromDoc = useCallback(
    (noteId: string, doc: GraphiumDocument | null | undefined) => {
      if (!doc) return;
      // doc キャッシュ（SidePeek 再オープン時の cachedDoc の源）を最新化
      docCacheRef.current.set(noteId, doc);
      // インデックス（一覧の「文脈」列表示の源）をエントリ単位で作り直す
      if (noteIndexRef.current) {
        const updated = updateIndexEntry(noteIndexRef.current, noteId, doc);
        noteIndexRef.current = updated;
        setNoteIndex(updated);
        queueSaveIndex(updated);
      }
    },
    [setNoteIndex, queueSaveIndex]
  );

  // 文脈ラベル（候補）を全ノートから一括削除する。使用中の各ノートから該当文脈を外して保存し、
  // インデックス・doc キャッシュを更新する。どのノートも使わなくなるので候補一覧からも消える。
  // 削除した件数を返す（呼び出し側の確認ダイアログは別途 count を見て出す）。
  const deleteNoteContextEverywhere = useCallback(
    async (value: string): Promise<number> => {
      const key = value.trim().toLowerCase();
      if (!key || !noteIndexRef.current) return 0;
      const targets = noteIndexRef.current.notes.filter((n) =>
        (n.noteContexts ?? []).some((c) => c.trim().toLowerCase() === key),
      );
      let updatedIndex = noteIndexRef.current;
      let removed = 0;
      for (const entry of targets) {
        const doc = await loadDoc(entry.noteId);
        if (!doc) continue;
        const next = normalizeNoteContexts(
          (doc.noteContexts ?? []).filter((c) => c.trim().toLowerCase() !== key),
        );
        const nextDoc: GraphiumDocument = {
          ...doc,
          noteContexts: next,
          modifiedAt: new Date().toISOString(),
        };
        try {
          await saveFile(entry.noteId, nextDoc);
          docCacheRef.current.set(entry.noteId, nextDoc);
          if (entry.noteId === activeFileIdRef.current) setActiveDoc(nextDoc);
          updatedIndex = updateIndexEntry(updatedIndex, entry.noteId, nextDoc);
          removed += 1;
        } catch (err) {
          console.error("文脈の一括削除に失敗:", entry.noteId, err);
        }
      }
      if (removed > 0) {
        noteIndexRef.current = updatedIndex;
        setNoteIndex(updatedIndex);
        queueSaveIndex(updatedIndex);
      }
      return removed;
    },
    [loadDoc, setNoteIndex, queueSaveIndex]
  );

  // 素材アップロード（メディアインデックス登録 + fileId / entry も返す）
  //
  // 「素材ライブラリ」経由の取り込み（Word/Excel 等のドキュメント、PDF、画像）で
  // 後段に親 fileId を渡したいときに使う。handleUploadMedia は本関数のラッパー。
  const handleUploadAsset = useCallback(
    async (
      file: File,
      options?: { derivedFromAssets?: string[] },
    ): Promise<{ url: string; fileId: string; entry: MediaIndexEntry }> => {
      const result = await uploadMediaFileWithMeta(file);
      const entry: MediaIndexEntry = {
        fileId: result.fileId,
        name: result.name,
        type: mimeToMediaType(result.mimeType),
        mimeType: result.mimeType,
        url: result.url,
        thumbnailUrl: result.url.replace("=s0", "=s200"),
        uploadedAt: new Date().toISOString(),
        usedIn: [],
        ...(options?.derivedFromAssets && options.derivedFromAssets.length > 0
          ? { derivedFromAssets: options.derivedFromAssets }
          : {}),
      };
      const current = mediaIndexRef.current ?? createEmptyIndex();
      const updated = addMediaEntry(current, entry);
      mediaIndexRef.current = updated;
      setMediaIndex(updated);
      saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
      return { url: result.url, fileId: result.fileId, entry };
    },
    [],
  );

  // メディアアップロード（インデックス自動登録付き）
  //
  // `options.derivedFromAssets` を渡すと、登録時に派生関係を MediaIndex に記録する。
  // 例: PDF から抽出した画像をアップロードするとき、元 PDF の fileId を渡せば
  // 画像モーダルから元 PDF を辿り、PDF モーダルから派生画像を辿れるようになる。
  const handleUploadMedia = useCallback(
    async (file: File, options?: { derivedFromAssets?: string[] }): Promise<string> => {
      const { url } = await handleUploadAsset(file, options);
      return url;
    },
    [handleUploadAsset],
  );

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
    const existing = entry.type === "url"
      ? current.media.find((m) => m.type === "url" && m.url === entry.url)
      : undefined;
    if (existing) {
      // 既に登録済み。usedIn の事前充填付き（SidePeek 経路）なら usedIn だけマージする。
      // SidePeek の保存は syncUsedIn を通らないため、ここで取り込まないと
      // 「2 回目以降の利用ノート」のグラフエッジが恒久的に欠落する。
      const incoming = entry.usedIn.filter(
        (u) => !existing.usedIn.some((e) => e.noteId === u.noteId),
      );
      if (incoming.length === 0) return;
      const updated = {
        ...current,
        updatedAt: new Date().toISOString(),
        media: current.media.map((m) =>
          m === existing ? { ...m, usedIn: [...m.usedIn, ...incoming] } : m,
        ),
      };
      mediaIndexRef.current = updated;
      setMediaIndex(updated);
      saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
      return;
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
          const validity = doc.wikiMeta?.grounding?.validity;
          next.set(wikiId, {
            title: doc.title,
            kind: doc.wikiMeta?.kind ?? existing?.kind ?? "claim",
            model: doc.wikiMeta?.generatedBy?.model ?? existing?.model,
            level: doc.wikiMeta?.level ?? existing?.level,
            status: doc.wikiMeta?.status ?? existing?.status,
            claimRole: doc.wikiMeta?.claimRole ?? existing?.claimRole,
            atomType: doc.wikiMeta?.atomType ?? existing?.atomType,
            synthesisMode: doc.wikiMeta?.synthesisMode ?? existing?.synthesisMode,
            hypothesisStatus: doc.wikiMeta?.hypothesisStatus ?? existing?.hypothesisStatus,
            theme:
              doc.wikiMeta?.kind === "synthesis"
                ? (doc.wikiMeta?.theme ?? existing?.theme)
                : undefined,
            // 世界モデル照合 validity の最小 mirror（Phase 2 / PR 2A）。
            // 一覧 verdict 列 / フィルタ / bulk 用。INDEX bump はしないので
            // NoteIndexEntry には伝播させない。
            // doc.wikiMeta があるならその validity が source of truth。undefined は
            // 「照合結果をクリアした」を意味するので existing にフォールバックしない
            // （フォールバックすると「照合を消す」がリストに反映されない）。
            // wikiMeta 自体が無い save（理論上のみ）だけ existing を温存する。
            groundingValidity: doc.wikiMeta
              ? validity
                ? {
                    verdict: validity.verdict,
                    checkedAt: validity.checkedAt,
                    entryId: validity.entryId,
                    dismissed: validity.dismissed,
                  }
                : undefined
              : existing?.groundingValidity,
          });
          return next;
        });
        // インデックスを更新
        if (noteIndexRef.current) {
          const updated = updateIndexEntry(noteIndexRef.current, wikiId, doc);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }
        // メディアインデックスの usedIn を同期 — Wiki ノートは PDF を
        // document-level (`wikiMeta.derivedFromNotes: ["pdf:..."]`) で参照するため、
        // 保存のたびに反映して PDF アセットモーダルの利用ノートグラフを最新に保つ。
        if (mediaIndexRef.current) {
          const mediaMap = doc.pages[0] ? extractMediaFromBlocks(doc.pages[0].blocks || []) : new Map<string, string>();
          const docPdfRefs = collectSourceAssetFileIdsFromDoc(doc);
          const updated = syncUsedIn(mediaIndexRef.current, `wiki:${wikiId}`, doc.title, mediaMap, docPdfRefs);
          mediaIndexRef.current = updated;
          setMediaIndex(updated);
          saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
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

  // Wiki をゴミ箱に送る（ソフトデリート）
  // - インデックスに deletedAt をセットするだけ。ファイル本体・他ノートからの参照は保持する
  // - 一覧・サイドバーからは消えるが、引用 / regenerate / グラフ探索からは引き続き解決できる
  // - 完全削除は TrashView から handlePermanentDelete 経由で行う
  // - wikiFiles state は触らない。触ると index 再構築 effect が発火し、
  //   trash エントリを「ai 系の旧エントリ」として除去してしまう。一覧表示の除外は
  //   フック return 側の `wikiFiles: wikiFiles.filter(...)` が担当する。
  const handleDeleteWikiFile = useCallback(
    async (wikiId: string) => {
      try {
        if (noteIndexRef.current) {
          const updated = softDeleteIndexEntry(noteIndexRef.current, wikiId);
          noteIndexRef.current = updated;
          setNoteIndex(updated);
          queueSaveIndex(updated);
        }
        if (activeFileId === `wiki:${wikiId}`) {
          setActiveFileId(null);
          setActiveDoc(null);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("Wiki のゴミ箱への移動に失敗:", err);
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
          queueSaveIndex(updated);
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
          queueSaveIndex(updated);
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
        queueSaveIndex(updated);
      }

      // メディアインデックスの usedIn を同期 — PROV / 翻訳など、PDF/URL を出典に持つ
      // AI 派生ノート（トップレベル sourcePdfFileId / wikiMeta.derivedFromNotes）が
      // 作成直後からアセットグラフの「利用ノート」に出るようにする。
      // （handleCreateNoteFromImport と同じ手順。これが無いと最初の再保存まで反映されない）
      if (mediaIndexRef.current && doc.pages[0]) {
        const mediaMap = extractMediaFromBlocks(doc.pages[0].blocks || []);
        const docAssetRefs = collectSourceAssetFileIdsFromDoc(doc);
        const updated = syncUsedIn(mediaIndexRef.current, newFileId, doc.title, mediaMap, docAssetRefs);
        mediaIndexRef.current = updated;
        setMediaIndex(updated);
        saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
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
        queueSaveIndex(updated);
      }

      // メディアインデックスの usedIn を同期 — Word/Markdown 取り込みで貼られた
      // 画像が画像モーダルのネットワーク表示に出るようにするため、handleSaveFile と
      // 同じ手順で逆引きを更新する。
      if (mediaIndexRef.current && doc.pages[0]) {
        const mediaMap = extractMediaFromBlocks(doc.pages[0].blocks || []);
        const docPdfRefs = collectSourceAssetFileIdsFromDoc(doc);
        const updated = syncUsedIn(mediaIndexRef.current, newFileId, doc.title, mediaMap, docPdfRefs);
        mediaIndexRef.current = updated;
        setMediaIndex(updated);
        saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
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
        queueSaveIndex(updated);
      }

      // 取り込み 2 パス目（リンク解決後）でも usedIn を同期しておく。
      // pass 1 と pass 2 で blocks が変わっていても、最新状態に追従させる。
      if (mediaIndexRef.current && doc.pages[0]) {
        const mediaMap = extractMediaFromBlocks(doc.pages[0].blocks || []);
        const docPdfRefs = collectSourceAssetFileIdsFromDoc(doc);
        const updated = syncUsedIn(mediaIndexRef.current, noteId, doc.title, mediaMap, docPdfRefs);
        mediaIndexRef.current = updated;
        setMediaIndex(updated);
        saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
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
        const validity = doc.wikiMeta?.grounding?.validity;
        next.set(newId, {
          title: doc.title,
          kind: doc.wikiMeta?.kind ?? "claim",
          model: doc.wikiMeta?.generatedBy?.model,
          level: doc.wikiMeta?.level,
          status: doc.wikiMeta?.status,
          claimRole: doc.wikiMeta?.claimRole,
          atomType: doc.wikiMeta?.atomType,
          synthesisMode: doc.wikiMeta?.synthesisMode,
          hypothesisStatus: doc.wikiMeta?.hypothesisStatus,
          theme: doc.wikiMeta?.kind === "synthesis" ? doc.wikiMeta?.theme : undefined,
          groundingValidity: validity
            ? {
                verdict: validity.verdict,
                checkedAt: validity.checkedAt,
                entryId: validity.entryId,
              }
            : undefined,
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
        queueSaveIndex(updated);
      }
      // メディアインデックスの usedIn を同期 — Knowledge 化（pdf-ingest 等）で
      // 新しい Wiki が作られた直後に PDF アセットの利用ノートに反映する。
      if (mediaIndexRef.current) {
        const mediaMap = doc.pages[0] ? extractMediaFromBlocks(doc.pages[0].blocks || []) : new Map<string, string>();
        const docPdfRefs = collectSourceAssetFileIdsFromDoc(doc);
        const updated = syncUsedIn(mediaIndexRef.current, `wiki:${newId}`, doc.title, mediaMap, docPdfRefs);
        mediaIndexRef.current = updated;
        setMediaIndex(updated);
        saveMediaIndex(updated).catch((err) => console.warn("メディアインデックス保存失敗:", err));
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

  // Skill のメタ情報（タイトル・説明・自動適用・適用言語）を更新する。
  // 本文ブロックには触らず、キャッシュ（無ければストレージ）の最新 doc をベースに書き換える。
  const handleUpdateSkillMeta = useCallback(
    async (
      skillId: string,
      values: { title: string; description: string; availableForIngest: boolean; language?: "ja" | "en" }
    ) => {
      try {
        const base = docCacheRef.current.get(`skill:${skillId}`) ?? (await loadSkillFile(skillId));
        const doc: GraphiumDocument = {
          ...base,
          title: values.title,
          skillMeta: {
            ...(base.skillMeta ?? { createdAt: new Date().toISOString() }),
            description: values.description,
            availableForIngest: values.availableForIngest,
            language: values.language,
          },
        };
        await saveSkillFile(skillId, doc);
        docCacheRef.current.set(`skill:${skillId}`, doc);
        setSkillMetas((prev) => {
          const next = new Map(prev);
          next.set(skillId, {
            title: doc.title,
            description: values.description,
            availableForIngest: values.availableForIngest,
            systemSkillId: doc.skillMeta?.systemSkillId,
            language: values.language,
          });
          return next;
        });
        setSkillFiles((prev) => prev.map((f) =>
          f.id === skillId
            ? { ...f, name: `${doc.title}.skill.graphium.json`, modifiedTime: new Date().toISOString() }
            : f
        ));
        // 開いている Skill のタイトル/メタが変わったらエディタ側にも反映する
        if (activeFileId === `skill:${skillId}`) {
          setActiveDoc(doc);
          setEditorKey((k) => k + 1);
        }
      } catch (err) {
        console.error("Skill メタ情報の更新に失敗:", err);
      }
    },
    [activeFileId]
  );

  // Recent ノートは noteIndex のアクティブエントリに存在するもののみ表示する。
  // 完全削除・ゴミ箱送りされたノートが localStorage 由来で残るのを防ぐ。
  // noteIndex 未ロード時はそのまま見せる（読み込み前に空になるのを避ける）。
  const visibleRecentNotes = useMemo(() => {
    if (!noteIndex) return recentNotes;
    const activeIds = new Set(noteIndex.notes.map((n) => n.noteId));
    return recentNotes.filter((n) => activeIds.has(n.noteId));
  }, [recentNotes, noteIndex]);

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
    recentNotes: visibleRecentNotes,
    noteIndex,
    rawNoteIndex,
    trashedNotes,
    archivedNotes,
    archivedIdSet,
    trashedIdSet,
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
    handleCreateLinkedNote,
    handleDeriveWholeNote,
    handleAiDeriveNote,
    handleDelete,
    handleArchiveNote,
    handleRestore,
    handlePermanentDelete,
    handleArchiveWikiFile,
    handleRestoreFromArchive,
    handleSendArchiveToTrash,
    getCachedDoc,
    loadDoc,
    updateNoteContexts,
    reindexNoteFromDoc,
    deleteNoteContextEverywhere,
    handleUploadMedia,
    handleUploadAsset,
    handleDeleteMedia,
    handleRenameMedia,
    handleUpdateMediaSharedRef,
    handleAddUrlBookmark,
    handleCreateNoteFromDocument,
    handleCreateNoteFromImport,
    handleSaveImportedDoc,
    // Wiki — アーカイブ・ゴミ箱のエントリは UI 表示・グラフから除外する
    // （ファイル本体は残るので、リンクや regenerate からは引き続き透過解決できる）
    wikiFiles: wikiFiles.filter((f) => !archivedIdSet.has(f.id) && !trashedIdSet.has(f.id)),
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
    handleUpdateSkillMeta,
  };
}
